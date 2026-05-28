/**
 * @file Tree-sitter grammar for the Navis (.navis) file format.
 * @author Carlos J. Ortiz
 * @license MIT OR Apache-2.0
 *
 * The grammar is built incrementally. Each rule lands with corpus tests
 * before moving to the next. This skeleton produces a parser that
 * `tree-sitter generate` can build and the Rust binding can load, so
 * the surrounding tooling (corpus tests, crate build) is wired end-to-end
 * before any real syntax lands.
 *
 * Target constructs (see Navis decisions doc):
 *   - Endpoint vars:        `@key = value`
 *   - Global file scripts:  `pre-request { ... }` / `post-request { ... }`  (opaque)
 *   - Request separator:    `### Name`
 *   - Per-request directive `# @no-cookie-jar`
 *   - Request line:         `METHOD URL`
 *   - Headers:              `Key: value`
 *   - Body:                 raw text (typed by content-type in later epics)
 *   - Per-request blocks:   `assert { ... }` / `tests { ... }` / `docs { ... }`  (opaque)
 *   - Placeholders:         `{{ qualifier.name }}`
 *   - Line comments:        `# ...`
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: 'navis',

  extras: $ => [
    /\s/,
    $.comment,
  ],

  rules: {
    // Placeholder root: a file is a stream of lines until the real grammar
    // lands. This is intentionally permissive so the generated parser can
    // be loaded by the Rust binding and the corpus harness.
    source_file: $ => repeat($._line),

    _line: $ => /[^\n]+/,

    comment: $ => token(seq('#', /[^\n]*/)),
  },
});
