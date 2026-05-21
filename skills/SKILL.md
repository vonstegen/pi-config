---
name: wiki
description: Persistent knowledge wiki at ~/wiki/ maintained by a background janitor daemon (gemma3:4b via Ollama). The wiki accumulates knowledge across sessions — entities, concepts, research, decisions. Use wiki_save tool to drop discoveries into the wiki. Read wiki pages for context before starting related work. Never directly edit wiki pages — let the janitor maintain consistency.
---

# LLM Wiki

A persistent, compounding knowledge base at `~/wiki/`. A background janitor daemon (hermes3:8b via Ollama) watches for new sources and incrementally maintains the wiki: creates pages, updates cross-references, flags contradictions, and keeps the index current.

Option B is enabled: **AgentMemory feeds the wiki**. On pi startup, the extension ensures AgentMemory server is running, starts a bridge process that polls AgentMemory exports, and writes new memories/sessions into `~/wiki/sources/agentmemory/`. The janitor then ingests them into structured wiki pages.

## How to Use

### Save discoveries
Use the `wiki_save` tool to drop important content into `~/wiki/sources/sessions/`. The janitor will pick it up:
- Key decisions and their rationale
- Research findings
- New concepts or entities discovered
- Important context from the current session

### Read for context
When starting work related to a topic, read relevant wiki pages first:
- `~/wiki/index.md` to see what exists
- `~/wiki/pages/entities/` for specific people, projects, tools
- `~/wiki/pages/concepts/` for ideas and patterns
- `~/wiki/pages/sources/` for summaries of ingested material
- `~/wiki/pages/sessions/` for past session summaries

Use `read` to load pages, `bash` with grep to search.

### Wiki structure
```
~/wiki/
├── SCHEMA.md           # Conventions (read this first if unfamiliar)
├── index.md            # Auto-maintained catalog
├── log.md              # Chronological activity log
├── pages/
│   ├── entities/       # People, projects, tools, companies
│   ├── concepts/       # Ideas, patterns, techniques
│   ├── sources/        # Summaries of ingested material
│   ├── sessions/       # Past session summaries
│   └── comparisons/    # Side-by-side analyses
├── sources/            # Raw sources (immutable)
│   └── sessions/       # Session exports
└── assets/             # Images
```

### Rules
- **Read** wiki pages for context freely
- **Save** content via `wiki_save` (drops it into sources/sessions/)
- **Never directly edit** wiki pages — the janitor maintains consistency
- The janitor runs in the background and processes sources after arrival (usually under a minute)
- AgentMemory exports are bridged into `sources/agentmemory/` automatically

### Wiki commands
- `/wiki-status` — check if janitor and AgentMemory bridge are running
- `/wiki-lint` — request a consistency check
