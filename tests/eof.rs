//! Verifies how the Rust binding (the real consumer, via navis-parser)
//! handles a file that omits the trailing newline at EOF.

use tree_sitter::Parser;

fn parse(src: &str) -> tree_sitter::Tree {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_navis::language())
        .expect("load grammar");
    parser.parse(src, None).expect("parse")
}

fn has_error_or_missing(node: tree_sitter::Node) -> bool {
    if node.is_error() || node.is_missing() {
        return true;
    }
    let mut cursor = node.walk();
    let found = node.children(&mut cursor).any(has_error_or_missing);
    found
}

#[test]
fn endpoint_var_without_trailing_newline() {
    let tree = parse("@base = http://localhost:3000");
    assert!(
        !has_error_or_missing(tree.root_node()),
        "no trailing newline should still parse cleanly: {}",
        tree.root_node().to_sexp()
    );
}

#[test]
fn request_without_trailing_newline() {
    let tree = parse("### Login\nGET https://api.example.com/users");
    assert!(
        !has_error_or_missing(tree.root_node()),
        "no trailing newline should still parse cleanly: {}",
        tree.root_node().to_sexp()
    );
}

#[test]
fn comment_without_trailing_newline() {
    let tree = parse("# just a comment");
    assert!(
        !has_error_or_missing(tree.root_node()),
        "no trailing newline should still parse cleanly: {}",
        tree.root_node().to_sexp()
    );
}
