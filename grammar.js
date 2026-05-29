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
  // with whitespace or `#` is kept whole.
  BODY: 6,
  // Header names outrank body lines so a `Name: value` line in the header
  // section is a header, not a body line. (Body is only reachable after the
  // blank line, where headers are no longer a candidate, so this never
  // steals a genuine body line.)
  HEADER: 7,
  // Block openers (`assert {`, `tests {`, ...) outrank header names and body
  // lines so a block ends the header/body section.
  BLOCK: 8,
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
      $.pre_request_block,
      $.post_request_block,
      $.request,
      $._blank_line,
    )),

    // ---- File-level scripts -------------------------------------------------

    // `pre-request { ... }` / `post-request { ... }` declared at file scope.
    // They run on EVERY request in the file; their position in the file
    // decides when they run. Content is opaque JS (parsed later via injection)
    // and uses the same column-0 closing-brace convention as the per-request
    // blocks.
    pre_request_block: $ => seq($._pre_request_open, optional($.block_content), $._block_close),
    post_request_block: $ => seq($._post_request_open, optional($.block_content), $._block_close),

    _pre_request_open: _ => token(prec(PREC.BLOCK, seq('pre-request', /[ \t]*/, '{', LINE_END))),
    _post_request_open: _ => token(prec(PREC.BLOCK, seq('post-request', /[ \t]*/, '{', LINE_END))),

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
      // Per-request prelude: directives (`# @no-cookie-jar`) and plain
      // comments may sit between the separator and the request line.
      repeat(choice(field('directive', $.directive), $.comment)),
      optional(WS),
      field('method', $.method),
      SEP_WS,
      field('url', $.target_url),
      optional(seq(SEP_WS, field('version', $.http_version))),
      NL,
      repeat(field('header', $.header)),
      // After the headers come, in any interleaving, blank lines, an opaque
      // body, and the named blocks. Headers are matched first (they precede
      // this repeat); a `Name: value` line is only a body line once a blank
      // line has ended the header section, after which `header` is no longer
      // a candidate. The precedence of `header_name` over body lines is what
      // keeps genuine headers from being swallowed as body.
      repeat(choice(
        $._blank_line,
        field('body', $.body),
        field('block', $._request_block),
      )),
    )),

    // ---- Per-request blocks -------------------------------------------------

    // Named blocks that follow a request: declarative assertions, JS tests,
    // and markdown docs. Their content is captured OPAQUELY for now; the
    // embedded language (JS for `tests`, markdown for `docs`) is parsed later
    // via tree-sitter injection. The `assert` DSL will be parsed by the host
    // grammar in a later step.
    //
    // Closing convention (adopted from Bruno): the block content is indented
    // and the closing `}` sits in column 0 on its own line. A `}` that is not
    // in column 0 is ordinary content, so nested braces in JS never close the
    // block early.
    _request_block: $ => choice(
      $.assert_block,
      $.tests_block,
      $.docs_block,
    ),

    assert_block: $ => seq($._assert_open, optional($.block_content), $._block_close),
    tests_block: $ => seq($._tests_open, optional($.block_content), $._block_close),
    docs_block: $ => seq($._docs_open, optional($.block_content), $._block_close),

    // The opener carries the keyword, the `{`, and the trailing newline as one
    // token, at BLOCK precedence so it wins over a body line. Requiring the
    // `{` means a body line that merely starts with the word (`tests passed`)
    // is NOT mistaken for a block.
    _assert_open: _ => token(prec(PREC.BLOCK, seq('assert', /[ \t]*/, '{', LINE_END))),
    _tests_open: _ => token(prec(PREC.BLOCK, seq('tests', /[ \t]*/, '{', LINE_END))),
    _docs_open: _ => token(prec(PREC.BLOCK, seq('docs', /[ \t]*/, '{', LINE_END))),

    block_content: $ => repeat1($._block_line),

    // Any line that does NOT start with `}` in column 0 (an indented `}` is
    // content). Empty lines are allowed inside a block.
    _block_line: _ => token(prec(PREC.BLOCK, seq(optional(/[^}\r\n][^\r\n]*/), LINE_END))),

    // The closing `}` in column 0, with its newline.
    _block_close: _ => token(prec(PREC.BLOCK, seq('}', LINE_END))),

    // The body is a run of contiguous non-blank lines, captured OPAQUELY:
    // typing (JSON/XML/GraphQL/...) is applied later via the Content-Type
    // header and language injection, not by sniffing the first byte here. It
    // ends at a blank line, a block opener, the next `###`, or end of file.
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

    header_name: _ => token(prec(PREC.HEADER, /[A-Za-z0-9!#$%&'*+\-.^_`|~]+/)),

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

    // A per-request directive: `# @name`. The `# @` prefix is a single token
    // at higher precedence than the comment prefix, so a directive is never
    // mis-lexed as a plain comment. The name is open-ended (`no-cookie-jar`
    // today; future directives need no grammar change — the runtime validates
    // which names are known).
    directive: $ => seq(
      $._directive_prefix,
      field('name', $.directive_name),
      optional(WS),
      NL,
    ),
    _directive_prefix: _ => token(prec(PREC.COMMENT_PREFIX + 1, /#[ \t]*@/)),
    directive_name: _ => /[a-zA-Z][a-zA-Z0-9-]*/,

    _blank_line: _ => seq(optional(WS), token(prec(-1, choice('\n', '\r\n', '\r')))),
  },
});
