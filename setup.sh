#!/bin/bash
# setup-pi-config.sh - Install pi configuration from this repo
# 
# Usage: ./setup.sh [--symlink|--copy]
#   --symlink  Create symlinks to ~/.pi/agent (default)
#   --copy     Copy files to ~/.pi/agent (overwrites)
#   --help     Show this help

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.pi/agent"
BACKUP_DIR="${HOME}/.pi/agent.backup.$(date +%Y%m%d_%H%M%S)"

mode="symlink"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --symlink) mode="symlink"; shift ;;
    --copy) mode="copy"; shift ;;
    --help) cat << 'EOF'
setup-pi-config.sh - Install pi configuration

Usage: ./setup.sh [options]

Options:
  --symlink  Create symlinks to ~/.pi/agent (default)
  --copy     Copy files to ~/.pi/agent (overwrites)
  --help     Show this help

Examples:
  ./setup.sh              # Symlink (default)
  ./setup.sh --copy       # Copy files
  
After setup, restart pi to load new config.
EOF
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "=== pi-config Setup ==="
echo "Mode: $mode"
echo "Target: $TARGET_DIR"
echo ""

# Backup existing config
if [[ -d "$TARGET_DIR" ]] && [[ ! -L "$TARGET_DIR" ]]; then
  echo "Backing up existing config to: $BACKUP_DIR"
  mv "$TARGET_DIR" "$BACKUP_DIR"
fi

# Create fresh directory
mkdir -p "$TARGET_DIR"

if [[ "$mode" == "symlink" ]]; then
  echo "Creating symlinks..."
  
  # Symlink config files
  ln -sf "$SCRIPT_DIR/settings.json" "$TARGET_DIR/settings.json"
  ln -sf "$SCRIPT_DIR/models.json" "$TARGET_DIR/models.json"
  ln -sf "$SCRIPT_DIR/keybindings.json" "$TARGET_DIR/keybindings.json"
  ln -sf "$SCRIPT_DIR/AGENTS.md" "$TARGET_DIR/AGENTS.md"
  
  # Symlink directories
  ln -sf "$SCRIPT_DIR/extensions" "$TARGET_DIR/extensions"
  ln -sf "$SCRIPT_DIR/skills" "$TARGET_DIR/skills"
  ln -sf "$SCRIPT_DIR/scripts" "$TARGET_DIR/scripts"
  
  # Create non-symlinked dirs (auth, sessions, logs, bin)
  mkdir -p "$TARGET_DIR/auth"
  mkdir -p "$TARGET_DIR/sessions"
  mkdir -p "$TARGET_DIR/logs"
  mkdir -p "$TARGET_DIR/bin"
  
  echo "Symlinks created. Run 'npm install' in each extension folder if needed."
  
else
  echo "Copying files..."
  
  # Copy config files
  cp "$SCRIPT_DIR/settings.json" "$TARGET_DIR/"
  cp "$SCRIPT_DIR/models.json" "$TARGET_DIR/"
  cp "$SCRIPT_DIR/keybindings.json" "$TARGET_DIR/"
  cp "$SCRIPT_DIR/AGENTS.md" "$TARGET_DIR/"
  
  # Copy directories
  cp -r "$SCRIPT_DIR/extensions" "$TARGET_DIR/"
  cp -r "$SCRIPT_DIR/skills" "$TARGET_DIR/"
  cp -r "$SCRIPT_DIR/scripts" "$TARGET_DIR/"
  
  # Create dirs
  mkdir -p "$TARGET_DIR/auth"
  mkdir -p "$TARGET_DIR/sessions"
  mkdir -p "$TARGET_DIR/logs"
  mkdir -p "$TARGET_DIR/bin"
  
  # Install extension dependencies
  if [[ -d "$TARGET_DIR/extensions/pi-permissions" ]]; then
    echo "Installing extension dependencies..."
    (cd "$TARGET_DIR/extensions/pi-permissions" && npm install --omit=dev 2>/dev/null || true)
  fi
  
  echo "Files copied."
fi

echo ""
echo "=== Done ==="
echo "Next steps:"
echo "  1. Review settings.json and add your API keys to auth.json"
echo "  2. Run 'pi --version' to verify pi is installed"
echo "  3. Restart pi to load new configuration"
echo ""
echo "Configuration at: $TARGET_DIR"
echo "Repo at: $SCRIPT_DIR"