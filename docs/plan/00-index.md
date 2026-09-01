# Plan — Master Index & Doc Architecture

This document defines **how this planning set is structured** and how it will be executed. It is the entry point for any human or agent reading this repo.

## Goal of this doc set

Produce a complete, unambiguous blueprint for the `movie-downloader-qbitorrent` project so that:

- A human can review the entire plan in under 15 minutes.
- An agent can execute the whole build top-to-bottom **without making design decisions**.
- Every task has a verifiable "done" condition.

## Doc layout

```
AGENTS.md                        # Project rules, commands, conventions — always read first
docs/plan/
  00-index.md                    # THIS FILE — overview, build order, doc conventions
  01-architecture.md             # System design: components, data flow, boundaries
  02-specs.md                    # Detailed contracts: API, data model, UI, providers
  03-tasks.md                    # Ordered, numbered milestones w/ acceptance criteria
```

## What each doc is FOR (and what it is NOT for)

| File | Contains | Must NOT contain |
|------|----------|------------------|
| `AGENTS.md` | Repo-level rules, run commands, edit conventions, pointer to this index | Project design decisions |
| `00-index.md` | Scope, goals, **locked decisions**, build order, conventions for the docs themselves | Implementation detail |
| `01-architecture.md` | Components, responsibilities, data flow diagrams, tech boundaries, what talks to what | Line-by-line implementation |
| `02-specs.md` | Concrete contracts: endpoints + payloads, schema, UI screens/flows, provider interfaces | Rationale, alternatives, opinions |
| `03-tasks.md` | Numbered tasks in build order; each with inputs, outputs, acceptance criteria | Design discussion |

## Rules for writing every doc

1. **Decisions, not options.** Every "we could use X or Y" becomes "we use X." No open choices left for the executor.
2. **Requirements + acceptance criteria, not prose.** Facts an agent can verify, e.g. "GET `/search?q=inception` returns 10 items with `name`, `seeders`, `magnet`." No ambiguous adjectives.
3. **One fact lives in one place.** If two docs disagree, the doc that "owns" it wins (ownership table below). Cross-reference instead of duplicating.
4. **Precise naming.** All names (endpoints, fields, tables, components, files) are written exactly once in `02-specs.md` and reused verbatim everywhere else.
5. **No "later"/"TBD" in a doc that the executor reads.** Anything unknown is recorded in this file under Open Questions, resolved, then moved into the relevant doc.

## Ownership table (single source of truth)

| Topic | Owned by |
|-------|----------|
| Tech stack, scope, build order | `00-index.md` |
| Components and data flow | `01-architecture.md` |
| API contracts, data model, UI, provider behavior | `02-specs.md` |
| Milestones, task order, acceptance criteria | `03-tasks.md` |

## Build order (how 03-tasks.md will be sequenced)

Every milestone must be independently runnable and verifiable before the next starts:

1. Project scaffold (repo layout, tooling, config, CI if any).
2. Core domain logic that has no external dependencies (unit-testable first).
3. External integrations one at a time, each behind an interface (torrent provider, qBittorrent API).
4. API layer over the domain logic.
5. UI/CLI layer.
6. End-to-end wiring, polish, and verification.

## Execution protocol

1. Agent reads `AGENTS.md`, then this file, then `03-tasks.md`.
2. Agent works through tasks **in order**. Each task names exactly which of the other docs to read.
3. After each task, the agent reports what it did and how the acceptance criteria were verified.
4. A human confirms each milestone before the next begins.

## Open Questions

(none yet — resolve items here, then move the resolution into the owning doc)

## Change log

| Date | Change |
|------|--------|
| 2026-09-01 | Created doc architecture and conventions. |
