#!/usr/bin/env bash
# pi-hermes-workflow.sh
#
# Run pi and Hermes Agent side-by-side using tmux.
# Left pane: pi (coding/CLI tasks)
# Right pane: Hermes Agent (messaging/automation/memory)
#
# Usage:
#   ./pi-hermes-workflow.sh [session-name]
#   ./pi-hermes-workflow.sh code-project
#
# Controls:
#   Ctrl+B then 1       — zoom left pane (pi)
#   Ctrl+B then 2       — zoom right pane (Hermes)
#   Ctrl+B then d       — detach (leave running)
#   Ctrl+B then l       — swap panes
#
# Requirements: tmux

SESSION_NAME="${1:-pi-hermes}"
HERMES_DIR="${HERMES_DIR:-$HOME/.hermes}"

# Kill existing session
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Create session with two vertical panes
tmux new-session -d -s "$SESSION_NAME" -n "pi"
tmux split-window -h -t "$SESSION_NAME:pi"
tmux select-pane -t "$SESSION_NAME:pi"

# Left pane: pi
tmux send-keys "pi" C-m

# Right pane: Hermes Agent (CLI mode)
tmux send-keys "hermes" C-m

# Set pane titles
tmux select-pane -t "$SESSION_NAME:pi.0" -T "pi"
tmux select-pane -t "$SESSION_NAME:pi.1" -T "hermes"

# Layout: 60% left (pi), 40% right (hermes)
tmux split-window -h -p 60 -t "$SESSION_NAME:pi"

# Zoom left by default
tmux resize-pane -t "$SESSION_NAME:pi.0" -x 80

echo "✅ Started tmux session '$SESSION_NAME'"
echo "   Left pane: pi"
echo "   Right pane: Hermes Agent"
echo ""
echo "   Attach with: tmux attach -t $SESSION_NAME"
echo "   Detach: Ctrl+B then D"
