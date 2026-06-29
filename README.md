# Micelio Code 🍄

A desktop coding assistant that maps your workspace into a knowledge graph.

Chat with local (Ollama) or cloud (OpenRouter) models. The app parses your code with tree-sitter, builds a graph, and feeds the model a compact, relevant context — not the whole repo.

## Features

- **Chat** with local (Ollama) and cloud (OpenRouter) models.
- **Knowledge graph** of your workspace, shown as an interactive treemap.
- **Node inspector** — preview any symbol's code and generate an AI summary.
- **Context window meter** with one-click compaction of older turns.
- **Transcript view** — see the exact context sent to the model.
- **Usage ledger** — tokens, cost, and raw request/response per turn.
- **System prompt editor** — read, edit, or reset the instructions.
- **Model roles** — assign different models to chat and summarize.
- **Tools** — terminal (with background tasks), file diffs, and vision.
- **Image attachments** — drop, paste, or pick an image.
- Light, dark, and system themes.

## Stack

- **Backend** — Rust + Tauri 2. Parsing via tree-sitter, storage via SQLite.
- **Frontend** — React 19 + TypeScript + Vite. State via Zustand, treemap via d3-hierarchy.

## Install

Grab the latest installer from the [Releases](../../releases) page.

### macOS

The app is not yet signed/notarized with an Apple Developer ID, so macOS puts it
in quarantine on first launch (you may see *"Micelio Code is damaged and can't be
opened"*). After dragging the app into `/Applications`, clear the quarantine
attribute:

```bash
xattr -dr com.apple.quarantine "/Applications/Micelio Code.app"
```

Then open it normally. This is a one-time step per download.

## Getting started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) and the [Tauri CLI](https://tauri.app/start/) (`cargo install tauri-cli`).
- [Node.js](https://nodejs.org) 18+.
- Optional: [Ollama](https://ollama.com) for local models, or an [OpenRouter](https://openrouter.ai) API key for cloud models.

### Run

```bash
cd frontend && npm install && cd ..
cargo tauri dev
```

### Build

```bash
cargo tauri build
```

## Configuration

Set your provider in **Settings → Providers**. Add an OpenRouter API key for cloud models, or point at a running Ollama instance for local ones. Then assign models to roles in the composer's **Models** selector.

## Layout

```
.
├── src/            # Rust backend (Tauri commands, graph, providers)
├── frontend/       # React app
│   └── src/
│       ├── views/        # Chat, Treemap, Usage
│       ├── components/   # UI
│       ├── store/        # Zustand slices
│       └── styles/       # CSS (tokens, buttons, components)
└── tauri.conf.json
```

## Versioning & Releases

This project uses [Semantic Versioning 2.0.0](https://semver.org/) and follows the [Conventional Commits](https://www.conventionalcommits.org/) specification.

We use Google's `release-please` to automate version bumps and changelog generation based on commit messages. When you merge a PR, `release-please` will automatically open a Release PR. Merging that PR will tag the new release and update the `CHANGELOG.md`.

* `feat:` triggers a MINOR bump.
* `fix:` triggers a PATCH bump.
* `feat!:` or `fix!:` (or `BREAKING CHANGE:`) triggers a MAJOR bump.

While under `0.x`, minor versions may include breaking changes without a MAJOR bump. See [`CHANGELOG.md`](./CHANGELOG.md) for history.
