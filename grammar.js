/**
 * @file Tree-sitter grammar for the Navis (.navis) file format.
 * @author Carlos J. Ortiz
 * @license MIT OR Apache-2.0
 *
 * The grammar is built incrementally. Each construct lands with corpus
 * tests before the next one is added.
 *
 * Design notes (informed by rest-nvim/tree-sitter-http, adapted — not forked):
 *   - `extras` is empty: `.navis` is line-oriented, so every space and line
 *     break is matched explicitly rather than skipped implicitly.
 *   - Text (values, URLs, request names) is tokenized char-by-char into word
 *     chars and punctuation, leaving placeholders as the only named text
 *     nodes. This gives highlighters fine-grained tokens to colour.
 *   - Newlines are matched via the shared `NL` token, which also accepts
 *     `\r\n` (Windows) and `\0` (end of file).
 *
 * Target constructs (see Navis decisions doc):
 *   - Endpoint vars:        `@key = value`
 *   - Global file scripts:  `pre-request { ... }` / `post-request { ... }`  (opaque)
 *   - Request separator:    `### Name`
 *   - Per-request directive `# @no-cookie-jar`
 *   - Request line:         `METHOD URL [HTTP/x.y]`
 *   - Headers:              `Key: value`
 *   - Body:                 raw text
 *   - Per-request blocks:   `assert { ... }` / `tests { ... }` / `docs { ... }`  (opaque)
 *   - Placeholders:         `{{ qualifier.name }}`
 *   - Line comments:        `# ...`
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Precedence levels for token-conflict resolution. Higher wins on ties.
const PREC = {
  COMMENT_PREFIX: 5,
  // Body lines outrank WS (0) and comments (5) so a body line that starts
  // with whitespace or `#` is kept whole, but stay below the separator so
  // `###` still terminates the body.
  BODY: 6,
  REQ_SEPARATOR: 9,
};

// Significant whitespace and line breaks, matched explicitly because
// `extras` is empty. `NL` also accepts `\0` (end of file) so the parse of a
// well-formed file resolves cleanly; a file that omits the final newline is
// still recovered by tree-sitter's error tolerance.
const WS = /[ \t]+/;
const NL = token(choice('\n', '\r\n', '\r', '\0'));

// Whitespace used as a SEPARATOR before a value/url. The higher precedence
// makes a leading space attach to the separator instead of being swallowed
// as the first whitespace token inside the value/url.
const SEP_WS = token(prec(1, /[ \t]+/));

// Char classes for text runs. Splitting word chars from punctuation (instead
// of one opaque chunk) gives highlighters categorised tokens to colour, and
// keeps placeholders as the only NAMED nodes inside a value/url.
const WORD_CHAR = /[\p{L}\p{N}]/u;
const PUNCTUATION = /[^\n\r\p{Z}\p{L}\p{N}]/u;

// The text of a body line that does NOT begin with the `###` request
// separator. Body lines must exclude `###` at column 0 so a body never
// swallows the next request; tree-sitter has no lookahead, so the cases are
// spelled out: a line whose first char is not `#`, a line with one or two
// leading `#` followed by a non-`#`, or a line of just one or two `#`.
const BODY_TEXT = choice(
  /[^#\r\n][^\r\n]*/,
  /##?[^#\r\n][^\r\n]*/,
  /##?/,
);
const LINE_END = choice('\n', '\r\n', '\r', '\0');

module.exports = grammar({
  name: 'navis',

  extras: _ => [],

  // Multi-line URL continuation is ambiguous until the next line is seen.
  conflicts: $ => [
    [$.target_url],
  ],

  rules: {
    source_file: $ => repeat(choice(
      $.comment,
      $.endpoint_var,
      $.request,
      $._blank_line,
    )),

    // ---- Endpoint vars ------------------------------------------------------

    endpoint_var: $ => seq(
      '@',
      field('name', $.identifier),
      optional(WS),
      '=',
      optional(SEP_WS),
      field('value', $.value),
      NL,
    ),

    // ---- Requests -----------------------------------------------------------

    // `prec.right` makes the request greedily absorb its trailing headers and
    // body instead of ending early and leaving them as top-level items.
    request: $ => prec.right(seq(
      $.request_separator,
      optional(WS),
      field('method', $.method),
      SEP_WS,
      field('url', $.target_url),
      optional(seq(SEP_WS, field('version', $.http_version))),
      NL,
      repeat(field('header', $.header)),
      optional($._body_section),
    )),

    // The blank line(s) separating headers from body are ALWAYS consumed by
    // this hidden section; the body content itself is optional. This means a
    // request followed by a blank line and then `###` (or EOF) leaves no
    // orphaned blank line — the body content is simply absent.
    _body_section: $ => prec.right(seq(
      repeat1($._blank_line),
      optional(field('body', $.body)),
    )),

    // The body is the raw text after the blank separator, running until the
    // next `###` separator or end of file. It is captured OPAQUELY: typing
    // (JSON/XML/GraphQL/...) is applied later via the Content-Type header and
    // language injection, not by sniffing the first byte here.
    body: $ => prec.right(repeat1($._body_line)),

    // A non-empty body line that does not begin with `###` (so the separator
    // always wins and terminates the body). Blank lines are not body lines —
    // they are consumed as separators — so a body is a run of contiguous
    // non-blank lines.
    _body_line: _ => token(prec(PREC.BODY, seq(BODY_TEXT, LINE_END))),

    // `Name: value`, one per line. The name follows RFC 7230 token chars
    // (more permissive than `[\w-]+` — `.`, `$`, etc. are legal in header
    // names). Whitespace is tolerated both before and after the colon.
    header: $ => seq(
      field('name', $.header_name),
      optional(WS),
      ':',
      optional(SEP_WS),
      optional(field('value', $.value)),
      NL,
    ),

    header_name: _ => token(/[A-Za-z0-9!#$%&'*+\-.^_`|~]+/),

    // `###` (three or more), optional name on the same line. The high
    // precedence keeps `###` from being lexed as a `#` comment.
    request_separator: $ => seq(
      token(prec(PREC.REQ_SEPARATOR, /###+[ \t]*/)),
      optional(field('name', $.value)),
      NL,
    ),

    // Closed set of methods: type-safe for the walker and fails fast on a
    // typo. GRAPHQL and WEBSOCKET are first-class Navis protocols.
    method: _ => choice(
      'OPTIONS', 'GET', 'HEAD', 'POST', 'PUT', 'DELETE',
      'TRACE', 'CONNECT', 'PATCH', 'GRAPHQL', 'WEBSOCKET',
    ),

    // `prec.dynamic` lets the parser prefer reading `HTTP/1.1` as a version
    // token instead of folding it into the greedy URL.
    http_version: _ => prec.dynamic(1, token(prec(1, /HTTP\/[\d.]+/))),

    // A URL may span multiple lines: a continuation is a newline followed by
    // indentation and more URL tokens.
    target_url: $ => seq(
      $._url_line,
      repeat(seq(NL, WS, $._url_line)),
    ),
    _url_line: $ => repeat1(choice(WORD_CHAR, PUNCTUATION, $.placeholder, WS)),

    // ---- Values & placeholders ---------------------------------------------

    value: $ => repeat1(choice(WORD_CHAR, PUNCTUATION, $.placeholder, WS)),

    placeholder: $ => seq(
      token(prec(1, '{{')),
      optional(WS),
      optional(seq(field('qualifier', $.qualifier), '.')),
      field('name', $.identifier),
      optional(WS),
      token(prec(1, '}}')),
    ),

    qualifier: _ => choice('workspace', 'api', 'endpoint', 'request'),

    // Variable identifier: permissive (Unicode, digits, `-`, `$`) but NOT
    // `.` — the dot is the qualifier separator inside a placeholder.
    identifier: _ => /[A-Za-z_$\d¡-￿-]+/,

    // ---- Comments -----------------------------------------------------------

    // A short `#` prefix token (length 1) loses to the `###` separator
    // (length >= 3) by longest-match, so `### Login` is never a comment.
    comment: $ => seq(
      token(prec(PREC.COMMENT_PREFIX, '#')),
      optional($._line_text),
      NL,
    ),
    _line_text: _ => token(/[^\r\n]+/),

    _blank_line: _ => seq(optional(WS), token(prec(-1, choice('\n', '\r\n', '\r')))),
  },
});
