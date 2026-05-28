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

  // Spaces, tabs and carriage returns are skipped between tokens.
  // Newlines (`\n`) are SIGNIFICANT — they separate top-level items —
  // so they are NOT in extras; they appear explicitly in the grammar.
  extras: _ => [
    /[ \t]/,
    /\r/,
  ],

  rules: {
    // A file is a sequence of top-level items: comments, endpoint vars,
    // and blank-line separators (anonymous newlines that don't appear in
    // the tree). Real constructs are added to this choice as they land.
    source_file: $ => repeat(choice(
      $.comment,
      $.endpoint_var,
      /\n/,
    )),

    // ---- Endpoint vars ------------------------------------------------------

    // `@key = value` at file scope. The value runs to the end of the line;
    // placeholders are not yet broken out of it.
    endpoint_var: $ => seq(
      '@',
      field('name', $.identifier),
      '=',
      field('value', $.value),
    ),

    identifier: _ => /[a-zA-Z_][a-zA-Z0-9_]*/,

    // `token(...)` makes the value a single lexer token so `extras` can't
    // sneak inside it (e.g. a stray space wouldn't split it). The body of
    // the regex stops at newline so the next top-level item starts.
    value: _ => token(/[^\r\n]+/),

    // ---- Comments -----------------------------------------------------------

    // Line comment: `#` followed by anything until end of line.
    // Disambiguating from directives like `# @no-cookie-jar` happens when
    // directives land — for now everything starting with `#` is a comment.
    comment: _ => token(seq('#', /[^\r\n]*/)),
  },
});
