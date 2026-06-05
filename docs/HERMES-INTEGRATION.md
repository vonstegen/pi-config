# Hermes Agent + pi Integration

Bridges [pi](https://pi.dev) with [Hermes Agent](https://hermes-agent.org) from Nous Research.

## What it does

- **pi calls Hermes sub-agents** — complex multi-step tasks get their own isolated context
- **Shared memory** — Hermes's persistent memory is injected as context on every pi session start
- **Shared skills** — Hermes skills (SKILL.md) are callable from pi via the `hermes_skill` tool
- **Side-by-side workflow** — run both in tmux with one command

## Components

| File | Purpose |
|------|---------|
| `extensions/pi-hermes-bridge.ts` | pi extension — tools + commands |
| `scripts/pi-hermes-workflow.sh` | tmux side-by-side launcher |

## Tools registered by the extension

| Tool | What it does |
|------|-------------|
| `hermes_subagent` | Spawns a Hermes sub-agent to handle a task, returns results |
| `hermes_memory` | Reads Hermes's persistent memory store as context |
| `hermes_skill` | Lists or runs a Hermes Agent skill |
| `hermes_status` | Checks if Hermes is installed, version, memory stats |

## Commands

| Command | Description |
|---------|-------------|
| `/hermes status` | Check Hermes installation status |
| `/hermes run <task>` | Spawn a Hermes sub-agent from pi |
| `/hermes install` | Show install instructions |

## Setup

### 1. Install Hermes Agent

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
hermes setup
```

### 2. Restart pi

```bash
pi
```

The extension auto-loads. You'll see a notification that Hermes is connected.

### 3. Side-by-side workflow (optional)

```bash
chmod +x scripts/pi-hermes-workflow.sh
./scripts/pi-hermes-workflow.sh my-project
```

This opens pi on the left and Hermes Agent on the right in tmux.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  pi (coding harness)                                │
│                                                     │
│  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │ pi-hermes-   │  │ hermes_memory tool           │ │
│  │ bridge.ext   │──│ injects ~/.hermes/memory/    │ │
│  │              │  │ into context on each session  │ │
│  │ hermes_subagent│                                  │ │
│  │ hermes_skill   │  ┌──────────────────────────┐ │ │
│  │ hermes_status  │  │ Hermes Agent             │ │ │
│  └──────────────┘  │ ~/.hermes/                │ │ │
│                    │ persistent memory        │ │ │
│                    │ skill system            │ │ │
│                    └──────────────────────────┘ │ │
└─────────────────────────────────────────────────────┘
```

## Skill sharing

Hermes Agent and pi both use the `SKILL.md` format (agentskills.io standard).

To make Hermes skills available to pi, symlink them:

```bash
mkdir -p ~/.pi/agent/skills/hermes
ln -s ~/.hermes/skills/* ~/.pi/agent/skills/hermes/
```

Then pi will auto-discover them as `/skill:<name>` commands.
