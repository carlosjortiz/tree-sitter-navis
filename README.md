# tree-sitter-navis

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for the **Navis `.navis` file format** — a file-first format for API requests with named blocks for scripts, assertions, tests, and docs.

## Status

Pre-MVP — under active development as part of the [Navis](https://github.com/carlosjortiz/navis-devspace) project. APIs and grammar nodes may change before v0.1.0.

## What the format looks like

```navis
@base = {{api.base_url}}

pre-request {
  vars.endpoint.startedAt = Date.now()
}

### Login
# @no-cookie-jar
POST {{base}}/auth/login
Content-Type: application/json

{ "email": "{{workspace.user_email}}", "password": "{{api.password}}" }

assert {
  response.status:     eq 200
  response.body.token: exists
}

post-request {
  vars.endpoint.token = response.body.token
}
```

The format defines:

- **Endpoint vars** at the top of the file (`@key = value`).
- **Global scripts** (`pre-request { ... }`, `post-request { ... }`) that run on every request in the file. Order between same-type scripts is determined by their position in the file.
- **Requests** separated by `###` and an optional name.
- Per-request directives (e.g. `# @no-cookie-jar`).
- Standard HTTP request lines: method + URL, headers, body.
- **Named blocks** per request:
  - `assert { ... }` — declarative assertions.
  - `tests { ... }` — imperative assertions (JS, Playwright-style `expect`).
  - `docs { ... }` — markdown documentation.
- Variable placeholders `{{var}}` with explicit qualifiers (`{{workspace.x}}`, `{{api.x}}`, `{{endpoint.x}}`, `{{request.x}}`).

Full design rationale lives in the [Navis decisions doc](https://github.com/carlosjortiz/navis-devspace/blob/main/docs/decisions.md).

## Bindings

This repo ships only the **Rust binding** (`bindings/rust/`) initially. Other language bindings (Node, Python, Go, Swift, C) can be added later if needed.

## Development

This project uses **pnpm** as its package manager (not npm).

```sh
pnpm install
pnpm tree-sitter generate    # produces src/parser.c
pnpm tree-sitter test        # runs the corpus tests
cargo build                  # builds the Rust crate
```

The generated `src/parser.c` is committed to the repo, so consumers of the crate don't need Node at build time.

## License

Dual licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT License ([LICENSE-MIT](LICENSE-MIT))

at your option.

## Inspiration

The design of this grammar is inspired by [`rest-nvim/tree-sitter-http`](https://github.com/rest-nvim/tree-sitter-http) (MIT) — used as a **reference of design**, not forked. Thanks to the rest.nvim community for the prior art.

The Navis format is intentionally **not** compatible with the various `.http` flavors out there (JetBrains, VS Code REST Client, httpYac, Hurl, Bruno). It borrows the readable request shape and the `{{var}}` placeholder convention, then diverges to fit Navis' own model (workspace/API/endpoint scopes, named blocks, GUI-first table-style assertions). See the [decisions doc](https://github.com/carlosjortiz/navis-devspace/blob/main/docs/decisions.md) for the full rationale.
