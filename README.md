# pi-config

My pi coding agent configuration — extensions, settings, skills, and scripts.

## Structure

```
pi-config/
├── AGENTS.md          # Project instructions
├── settings.json      # User settings
├── models.json        # Custom model providers
├── keybindings.json   # Keybinding overrides
├── extensions/
│   ├── chat-tree.ts   # Obsidian Chat-Tree integration
│   ├── vibellm.ts     # Local fine-tuning integration
│   ├── pi-permissions/ # Claude-style permission modes
│   ├── agentmemory/   # Cross-session memory
│   └── wiki-janitor/  # Wiki maintenance
├── skills/
│   └── wiki/          # Wiki skill
└── scripts/
    └── start-pi.sh    # Launcher
```

## Setup

```bash
git clone <repo> ~/pi-config
ln -s ~/pi-config ~/.pi/agent  # or copy files
```

## Extensions

### pi-permissions (Claude-style permission modes)

6 modes: default, acceptEdits, plan, auto, dontAsk, bypass.

```bash
# Cycle modes
/mode [name]

# Disable for session
/permissions-disable

# Start in mode
pi --permission-mode plan
pi --permissions-enabled=false
```

### chat-tree

Maps pi sessions to Obsidian vault Chat-Trees.

```bash
/ct status      # Overview
/ct trunks       # List trunks
/ct use <trunk>  # Switch context
/ct search <q>   # Search turns
```

## Keybindings

| Key | Action |
|-----|--------|
| Shift+Tab | Cycle permission modes |
| Ctrl+Alt+P | Cycle permission modes (default) |
| Ctrl+P | Cycle models |
| Ctrl+L | Model selector |

## Notes

- `auth.json` is gitignored (contains API keys)
- `node_modules/` is gitignored (reinstall with `npm install` per extension)
- Sessions are gitignored (stored in `~/.pi/agent/sessions/`)
- `bin/` (fd, rg binaries) is gitignored
