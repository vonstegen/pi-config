#!/bin/bash
# setup-pi-config.sh - Install pi configuration from this repo
#
# Usage: ./setup.sh [options]
#   --symlink  Create symlinks to ~/.pi/agent config dirs (default)
#   --copy     Copy files to ~/.pi/agent
#   --help     Show this help
#
# This only affects tracked config files. It will NOT touch:
#   - sessions/  (ephemeral, kept as-is)
#   - auth.json  (API keys, kept as-is)
#   - logs/      (ephemeral, kept as-is)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.pi/agent"

mode="symlink"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --symlink) mode="symlink"; shift ;;
    --copy) mode="copy"; shift ;;
    --help) cat << 'EOF'
setup-pi-config.sh - Install pi configuration

Usage: ./setup.sh [options]

Options:
  --symlink  Create symlinks to ~/.pi/agent config dirs (default)
  --copy     Copy files to ~/.pi/agent config dirs
  --help     Show this help

This only affects tracked config files:
  - extensions/  (pi extensions)
  - skills/       (pi skills)
  - scripts/      (launcher scripts)
  - settings.json (user settings)
  - models.json   (custom model providers)
  - keybindings.json (keybindings)
  - AGENTS.md     (project instructions)

This will NOT touch:
  - sessions/  (ephemeral data)
  - auth.json  (API keys)
  - logs/      (ephemeral data)

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

# Ensure target directory exists
mkdir -p "$TARGET_DIR"

# Files/dirs to sync (in repo -> in ~/.pi/agent)
declare -a TRACKED_ITEMS=(
  "settings.json"
  "models.json"
  "keybindings.json"
  "AGENTS.md"
  "extensions"
  "skills"
  "scripts"
)

if [[ "$mode" == "symlink" ]]; then
  echo "Creating symlinks..."
  
  for item in "${TRACKED_ITEMS[@]}"; do
    src="${SCRIPT_DIR}/${item}"
    tgt="${TARGET_DIR}/${item}"
    
    if [[ -e "$src" ]]; then
      # Backup existing if it's a real file/dir (not a symlink)
      if [[ -e "$tgt" ]] && [[ ! -L "$tgt" ]]; then
        backup="${tgt}.backup.$(date +%Y%m%d_%H%M%S)"
        echo "  Backing up: $item -> $backup"
        mv "$tgt" "$backup"
      elif [[ -L "$tgt" ]]; then
        echo "  Removing old symlink: $item"
        rm "$tgt"
      fi
      
      echo "  Linking: $item"
      ln -sf "$src" "$tgt"
    else
      echo "  Skipping (not in repo): $item"
    fi
  done
  
  # Install extension dependencies
  if [[ -L "$TARGET_DIR/extensions/pi-permissions" ]] || [[ -d "$TARGET_DIR/extensions/pi-permissions" ]]; then
    perm_dir="${TARGET_DIR}/extensions/pi-permissions"
    # Resolve symlink if needed
    [[ -L "$perm_dir" ]] && perm_dir="$(readlink -f "$perm_dir")"
    if [[ -f "${perm_dir}/package.json" ]]; then
      echo "Installing extension dependencies..."
      (cd "$perm_dir" && npm install --omit=dev 2>/dev/null || npm install 2>/dev/null || true)
    fi
  fi
  
  echo ""
  echo "Symlinks created!"
  
else
  echo "Copying files..."
  
  for item in "${TRACKED_ITEMS[@]}"; do
    src="${SCRIPT_DIR}/${item}"
    tgt="${TARGET_DIR}/${item}"
    
    if [[ -e "$src" ]]; then
      if [[ -L "$tgt" ]]; then
        rm "$tgt"
      elif [[ -e "$tgt" ]]; then
        backup="${tgt}.backup.$(date +%Y%m%d_%H%M%S)"
        echo "  Backing up: $item -> $backup"
        mv "$tgt" "$backup"
      fi
      
      echo "  Copying: $item"
      if [[ -d "$src" ]]; then
        cp -r "$src" "$tgt"
      else
        cp "$src" "$tgt"
      fi
    else
      echo "  Skipping (not in repo): $item"
    fi
  done
  
  echo ""
  echo "Files copied!"
fi

echo ""
echo "=== Done ==="
echo ""
echo "Config files synced:"
for item in "${TRACKED_ITEMS[@]}"; do
  [[ -e "${SCRIPT_DIR}/${item}" ]] && echo "  - $item"
done
echo ""
echo "IMPORTANT: Review auth.json and add your API keys!"
echo "  - Template: ~/pi-config/auth.json.example"
echo "  - Actual: ~/.pi/agent/auth.json (not in repo, kept as-is)"
echo ""
echo "Restart pi to load new configuration:"
echo "  pi"
echo ""
echo "Repository: https://github.com/vonstegen/pi-config"
echo "To update:  cd ~/pi-config && git pull"