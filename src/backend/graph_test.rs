#![allow(dead_code)]

use crate::backend::knowledge::{KnowledgeGraph, NodeKind};

pub fn create_test_graph() -> KnowledgeGraph {
    let mut g = KnowledgeGraph::new();

    g.add_with_desc(
        "Rust Ecosystem",
        "Comprehensive Rust programming language ecosystem",
        NodeKind::Concept,
    );

    // Depth 1 — categories (Concept)
    g.add_with_desc(
        "Web Frameworks",
        "HTTP server frameworks for building web applications",
        NodeKind::Concept,
    );
    g.add_with_desc(
        "Async Runtime",
        "Asynchronous execution runtime foundations",
        NodeKind::Concept,
    );
    g.add_with_desc(
        "Data & Serialization",
        "Data handling, serialization, and databases",
        NodeKind::Concept,
    );
    g.add_with_desc(
        "CLI & Tooling",
        "Command-line utilities and developer tooling",
        NodeKind::Concept,
    );
    g.add_with_desc(
        "Systems Programming",
        "Low-level systems programming crates",
        NodeKind::Concept,
    );
    g.add_with_desc(
        "Testing & Quality",
        "Testing frameworks and code quality tools",
        NodeKind::Concept,
    );

    // Depth 2 — (File, Directory, Concept)
    g.add_with_desc(
        "Actix Web",
        "High-performance actor-based HTTP framework",
        NodeKind::File,
    );
    g.add_with_desc(
        "Axum",
        "Ergonomic web framework built on Tower and Hyper",
        NodeKind::File,
    );
    g.add_with_desc(
        "Rocket",
        "Type-safe web framework with code-generation",
        NodeKind::File,
    );

    g.add_with_desc(
        "Tokio",
        "Industry-standard async runtime with multi-threaded scheduler",
        NodeKind::File,
    );
    g.add_with_desc("Async-std", "Async version of std library", NodeKind::File);
    g.add_with_desc(
        "Futures",
        "Core async primitives and combinators",
        NodeKind::File,
    );

    g.add_with_desc(
        "Serde",
        "Generic serialization/deserialization framework",
        NodeKind::File,
    );
    g.add_with_desc(
        "SQLx",
        "Async SQL toolkit with compile-time query verification",
        NodeKind::File,
    );
    g.add_with_desc(
        "Reqwest",
        "Async HTTP client with TLS and cookie support",
        NodeKind::File,
    );

    g.add_with_desc(
        "Clap",
        "Feature-rich argument parser with derive macros",
        NodeKind::File,
    );
    g.add_with_desc(
        "Ratatui",
        "Terminal UI framework for rich TUIs",
        NodeKind::File,
    );

    g.add_with_desc(
        "Rayon",
        "Data-parallelism library for safe multithreading",
        NodeKind::File,
    );
    g.add_with_desc(
        "Crossbeam",
        "Lock-free data structures and concurrency tools",
        NodeKind::File,
    );

    g.add_with_desc(
        "Criterion",
        "Statistical benchmarking framework",
        NodeKind::File,
    );
    g.add_with_desc(
        "Proptest",
        "Property-based testing with shrinking",
        NodeKind::File,
    );

    // Depth 3 — Function, Class, Note, Directory
    g.add_with_desc(
        "handle_request",
        "Processes incoming HTTP requests and routes to handlers",
        NodeKind::Function,
    );
    g.add_with_desc(
        "run_worker",
        "Spawns async tasks on the thread-pool for concurrent execution",
        NodeKind::Function,
    );
    g.add_with_desc(
        "deserialize_msg",
        "Converts byte streams into typed data structures",
        NodeKind::Function,
    );
    g.add_with_desc(
        "parse_cli_args",
        "Parses command-line arguments into a config struct",
        NodeKind::Function,
    );

    g.add_with_desc(
        "AppConfig",
        "Application configuration loaded from environment and files",
        NodeKind::Class,
    );
    g.add_with_desc(
        "DatabasePool",
        "Thread-safe connection pool with health checking",
        NodeKind::Class,
    );
    g.add_with_desc(
        "MetricsCollector",
        "Collects and exposes runtime metrics via a scrape endpoint",
        NodeKind::Class,
    );
    g.add_with_desc(
        "TestSuite",
        "Organizes property-based and integration test cases",
        NodeKind::Class,
    );

    g.add_with_desc(
        "Upgrade plans",
        "Tokio 1.x → 2.x migration requires trait changes",
        NodeKind::Note,
    );
    g.add_with_desc(
        "Bench config",
        "Criterion uses --bench flag; disable with default-features",
        NodeKind::Note,
    );

    g.add_with_desc(
        "examples",
        "Example projects demonstrating framework usage",
        NodeKind::Directory,
    );
    g.add_with_desc(
        "benchmarks",
        "Benchmark harnesses and datasets for performance tests",
        NodeKind::Directory,
    );

    let eco = g.find_by_label("Rust Ecosystem").unwrap();
    let web = g.find_by_label("Web Frameworks").unwrap();
    let async_r = g.find_by_label("Async Runtime").unwrap();
    let data = g.find_by_label("Data & Serialization").unwrap();
    let cli = g.find_by_label("CLI & Tooling").unwrap();
    let sys = g.find_by_label("Systems Programming").unwrap();
    let test = g.find_by_label("Testing & Quality").unwrap();

    g.connect(eco, web);
    g.connect(eco, async_r);
    g.connect(eco, data);
    g.connect(eco, cli);
    g.connect(eco, sys);
    g.connect(eco, test);

    g.connect(web, g.find_by_label("Actix Web").unwrap());
    g.connect(web, g.find_by_label("Axum").unwrap());
    g.connect(web, g.find_by_label("Rocket").unwrap());

    g.connect(async_r, g.find_by_label("Tokio").unwrap());
    g.connect(async_r, g.find_by_label("Async-std").unwrap());
    g.connect(async_r, g.find_by_label("Futures").unwrap());

    g.connect(data, g.find_by_label("Serde").unwrap());
    g.connect(data, g.find_by_label("SQLx").unwrap());
    g.connect(data, g.find_by_label("Reqwest").unwrap());

    g.connect(cli, g.find_by_label("Clap").unwrap());
    g.connect(cli, g.find_by_label("Ratatui").unwrap());

    g.connect(sys, g.find_by_label("Rayon").unwrap());
    g.connect(sys, g.find_by_label("Crossbeam").unwrap());

    g.connect(test, g.find_by_label("Criterion").unwrap());
    g.connect(test, g.find_by_label("Proptest").unwrap());

    // Connect depth-3 nodes
    let tokio = g.find_by_label("Tokio").unwrap();
    g.connect(tokio, g.find_by_label("handle_request").unwrap());
    g.connect(tokio, g.find_by_label("run_worker").unwrap());
    g.connect(tokio, g.find_by_label("AppConfig").unwrap());
    g.connect(tokio, g.find_by_label("Upgrade plans").unwrap());
    g.connect(tokio, g.find_by_label("examples").unwrap());

    let serde = g.find_by_label("Serde").unwrap();
    g.connect(serde, g.find_by_label("deserialize_msg").unwrap());
    g.connect(serde, g.find_by_label("DatabasePool").unwrap());
    g.connect(serde, g.find_by_label("Bench config").unwrap());

    let clap = g.find_by_label("Clap").unwrap();
    g.connect(clap, g.find_by_label("parse_cli_args").unwrap());

    let criterion = g.find_by_label("Criterion").unwrap();
    g.connect(criterion, g.find_by_label("MetricsCollector").unwrap());
    g.connect(criterion, g.find_by_label("TestSuite").unwrap());
    g.connect(criterion, g.find_by_label("benchmarks").unwrap());

    g
}

pub fn create_simple_test_graph() -> KnowledgeGraph {
    let mut g = KnowledgeGraph::new();

    g.add_with_desc("Root", "Project root directory", NodeKind::Directory);
    g.add_with_desc("src", "Source code directory", NodeKind::Directory);
    g.add_with_desc(
        "app.rs",
        "Main application entry point and TUI logic",
        NodeKind::File,
    );
    g.add_with_desc(
        "lib.rs",
        "Library crate root with shared utilities",
        NodeKind::File,
    );
    g.add_with_desc(
        "tests",
        "Integration and unit test directory",
        NodeKind::Directory,
    );
    g.add_with_desc(
        "integration.rs",
        "End-to-end integration tests",
        NodeKind::File,
    );

    let root = g.find_by_label("Root").unwrap();
    let src = g.find_by_label("src").unwrap();
    let tests = g.find_by_label("tests").unwrap();
    let app = g.find_by_label("app.rs").unwrap();
    let lib = g.find_by_label("lib.rs").unwrap();
    let integration = g.find_by_label("integration.rs").unwrap();

    g.connect(root, src);
    g.connect(root, tests);
    g.connect(src, app);
    g.connect(src, lib);
    g.connect(tests, integration);

    g
}

pub fn create_large_test_graph() -> KnowledgeGraph {
    let mut g = KnowledgeGraph::new();

    let categories = [
        ("Web", "Web technologies and protocols"),
        ("Data", "Data storage, processing and serialization"),
        ("Systems", "Systems programming and OS interfaces"),
        ("AI", "Artificial intelligence and machine learning"),
        ("DevOps", "Deployment, CI/CD and infrastructure"),
        ("Languages", "Programming languages and compilers"),
        ("Security", "Cybersecurity and cryptography"),
        ("Graphics", "Computer graphics and rendering"),
        ("Networking", "Network protocols and distributed systems"),
        ("Mobile", "Mobile development frameworks"),
    ];

    g.add_with_desc(
        "Tech Landscape",
        "Comprehensive technology landscape overview",
        NodeKind::Concept,
    );

    for (cat, desc) in &categories {
        g.add_with_desc(cat, desc, NodeKind::Concept);

        for i in 1..=5 {
            let sub = format!("{}-{}", cat, i);
            let sub_desc = format!("Sub-area {} of {}", i, cat);
            g.add_with_desc(&sub, &sub_desc, NodeKind::Concept);

            for j in 1..=4 {
                let item = format!("{}.{}", sub, j);
                let item_desc = format!("Specific component {} in {}", j, sub);
                g.add_with_desc(&item, &item_desc, NodeKind::File);
            }
        }
    }

    let root = g.find_by_label("Tech Landscape").unwrap();

    for (cat, _) in &categories {
        let cat_id = g.find_by_label(cat).unwrap();
        g.connect(root, cat_id);

        for i in 1..=5 {
            let sub = format!("{}-{}", cat, i);
            let sub_id = g.find_by_label(&sub).unwrap();
            g.connect(cat_id, sub_id);

            for j in 1..=4 {
                let item = format!("{}.{}", sub, j);
                let item_id = g.find_by_label(&item).unwrap();
                g.connect(sub_id, item_id);
            }
        }
    }

    g
}
