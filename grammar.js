/**
 * @file Tree-sitter grammar for the Navis (.navis) file format.
 * @author Carlos J. Ortiz
 * @license MIT OR Apache-2.0
 *
 * The grammar is built incrementally. Each construct lands with corpus
 * tests before the next one is added.
 *
 * Target constructs (see Navis decisions doc):
 *   - Endpoint vars:        `@key = value`
 *   - Global file scripts:  `pre-request { ... }` / `post-request { ... }`  (opaque)
 *   - Request separator:    `### Name`
 *   - Per-request directive `# @no-cookie-jar`
 *   - Request line:         `METHOD URL`
 *   - Headers:              `Key: value`
 *   - Body:                 raw text
 *   - Per-request blocks:   `assert { ... }` / `tests { ... }` / `docs { ... }`  (opaque)
 *   - Placeholders:         `{{ qualifier.name }}`
 *   - Line comments:        `# ...`
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: 'navis',

  extras: _ => [
    /[ \t]/,
    /\r/,
  ],

  rules: {
    source_file: $ => repeat(choice(
      $.comment,
      $.endpoint_var,
      $.request,
      /\n/,
    )),

    // ---- Endpoint vars ------------------------------------------------------

    endpoint_var: $ => seq(
      '@',
      field('name', $.identifier),
      '=',
      field('value', $.value),
    ),

    identifier: _ => /[a-zA-Z_][a-zA-Z0-9_]*/,

    value: $ => repeat1(choice(
      $.placeholder,
      $.text_literal,
    )),

    text_literal: _ => token(prec(-1, /[^{\r\n]+/)),

    // ---- Placeholders -------------------------------------------------------

    placeholder: $ => seq(
      '{{',
      optional(seq(field('qualifier', $.qualifier), '.')),
      field('name', $.identifier),
      '}}',
    ),

    qualifier: _ => choice('workspace', 'api', 'endpoint', 'request'),

    // ---- Requests -----------------------------------------------------------

    // A request is a `###` separator (with an optional name on the same
    // line) followed by a request line (method + URL). Headers, body and
    // per-request blocks will join this sequence as they land.
    request: $ => seq(
      '###',
      optional(field('name', $.request_name)),
      /\n/,
      field('method', $.method),
      field('url', $.url),
    ),

    // The name is whatever follows `###` on the same line. It is captured
    // greedily up to the newline; trailing whitespace is part of the match
    // but harmless for downstream consumers.
    request_name: _ => /[^\r\n]+/,

    // Open-ended HTTP method: any run of uppercase letters. This avoids
    // maintaining an enum and accommodates extensions like WebDAV's
    // PROPFIND, MKCOL, etc., without grammar changes.
    method: _ => /[A-Z]+/,

    // The URL shares its interpolation shape with `value`: a sequence of
    // placeholders and literal text chunks. Modeling it this way means
    // `{{api.host}}/v1/users/{{id}}` produces a typed AST the walker can
    // resolve directly instead of re-scanning the URL for `{{ ... }}`.
    url: $ => repeat1(choice(
      $.placeholder,
      $.text_literal,
    )),

    // ---- Comments -----------------------------------------------------------

    // Line comment: `#` followed either by end of line or by a space/tab
    // and the rest of the line. Requiring whitespace after the `#` keeps
    // the request separator `###` (and any future `##`-prefixed token)
    // out of the comment match — without it, the longest-match lexer would
    // swallow `### Login` as a comment.
    comment: _ => token(seq('#', optional(seq(/[ \t]/, /[^\r\n]*/)))),
  },
});
