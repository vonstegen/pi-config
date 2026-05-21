#!/bin/bash
# Start Pi with agentmemory auto-start

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting agentmemory server...${NC}"

# Start agentmemory in background with output redirected to log file
nohup npx @agentmemory/agentmemory > ~/.pi/agent/logs/agentmemory.log 2>&1 &
AGENTMEMORY_PID=$!

# Create logs directory if needed
mkdir -p ~/.pi/agent/logs

# Wait for server to be ready
sleep 4

# Quick check if server is up
if curl -s http://localhost:3111/health > /dev/null 2>&1; then
  echo -e "${GREEN}agentmemory started (PID: $AGENTMEMORY_PID)${NC}"
else
  echo -e "${YELLOW}agentmemory starting (checking logs if issues)...${NC}"
fi

echo -e "${YELLOW}Starting pi...${NC}"
echo ""

# Start pi
pi

# When pi exits, clean up agentmemory
echo -e "${YELLOW}Cleaning up agentmemory server...${NC}"
kill $AGENTMEMORY_PID 2>/dev/null

echo -e "${GREEN}Done!${NC}"