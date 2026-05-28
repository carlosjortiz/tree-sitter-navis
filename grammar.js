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

    // The value is no longer a flat token: it interleaves literal text and
    // placeholders so the walker (US-2) can resolve variables without
    // re-parsing the value at runtime.
    value: $ => repeat1(choice(
      $.placeholder,
      $.text_literal,
    )),

    // Literal chunk of a value: anything that is not `{` or end of line.
    // `prec(-1)` makes the parser prefer `placeholder` when both could
    // match. A bare `{` in a value is therefore an error today — fine for
    // MVP; we'll relax it if a real case shows up.
    text_literal: _ => token(prec(-1, /[^{\r\n]+/)),

    // ---- Placeholders -------------------------------------------------------

    // `{{ name }}` or `{{ qualifier.name }}`. The four qualifier names
    // mirror the variable scopes defined in the decisions doc.
    placeholder: $ => seq(
      '{{',
      optional(seq(field('qualifier', $.qualifier), '.')),
      field('name', $.identifier),
      '}}',
    ),

    qualifier: _ => choice('workspace', 'api', 'endpoint', 'request'),

    // ---- Comments -----------------------------------------------------------

    comment: _ => token(seq('#', /[^\r\n]*/)),
  },
});
