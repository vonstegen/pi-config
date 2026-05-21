#!/bin/bash
# Start Pi with agentmemory in separate terminal (gnome-terminal)

echo "Starting agentmemory server in new terminal..."
gnome-terminal -- bash -c "npx @agentmemory/agentmemory; echo 'agentmemory stopped'; exec bash" &

sleep 3

echo "agentmemory server started. Starting pi..."
pi
