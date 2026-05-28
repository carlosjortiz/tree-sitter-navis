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
 *   - Body:                 raw text (typed by content-type in later epics)
 *   - Per-request blocks:   `assert { ... }` / `tests { ... }` / `docs { ... }`  (opaque)
 *   - Placeholders:         `{{ qualifier.name }}`
 *   - Line comments:        `# ...`
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: 'navis',

  extras: _ => [
    /[ \t\r\n]/,
  ],

  rules: {
    // A file is, for now, a (possibly empty) sequence of comments.
    // Each real construct (endpoint vars, requests, etc.) joins this
    // choice as it lands, one at a time.
    source_file: $ => repeat($.comment),

    // Line comment: `#` followed by anything until end of line.
    // Disambiguating from directives like `# @no-cookie-jar` happens when
    // directives land — for now everything starting with `#` is a comment.
    comment: _ => token(seq('#', /[^\n]*/)),
  },
});
