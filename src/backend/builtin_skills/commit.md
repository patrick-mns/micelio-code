---
name: commit
display-name: Commit
description: Write commit messages following the Conventional Commits spec.
---

# Commit

When writing commit messages, follow Conventional Commits:

```
<type>(<scope>): <short imperative summary>
```

## Types

- `feat` — new user-facing functionality
- `fix` — bug fix
- `refactor` — code change that neither fixes a bug nor adds a feature
- `perf` — performance improvement
- `docs` — documentation only
- `test` — adding or fixing tests
- `chore` — build, tooling, dependencies

## Rules

- Scope is the area touched (e.g. `ui`, `api`, `auth`); omit it when the
  change is global.
- Summary in lowercase, imperative mood, no trailing period, ≤ 72 chars.
- Body (optional): explain the *why*, not the diff; wrap at 72 columns.
- Breaking changes: add a `BREAKING CHANGE:` footer.
- One logical change per commit — if the diff mixes concerns, suggest
  splitting it.

## Examples

```
feat(skills): load Claude Code skills from .claude/skills
fix(ui): preserve panel content during close animation
refactor: extract SuggestPalette from CommandPalette
```
