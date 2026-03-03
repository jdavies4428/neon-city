#!/usr/bin/env bash
# Neon City — Notification Hook for Claude Code
# Detects permission prompts (approval requests) and sends notifications
# Install: Add to .claude/settings.local.json hooks.PreToolUse

NEON_CITY_URL="${NEON_CITY_URL:-http://localhost:5174}"

# Read event JSON from stdin
INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
HOOK_TYPE=$(echo "$INPUT" | grep -o '"hook_type":"[^"]*"' | head -1 | cut -d'"' -f4)

# Only fire on PreToolUse (agent is about to do something, may need approval)
if [ "$HOOK_TYPE" != "PreToolUse" ]; then
  exit 0
fi

AGENT_ID="${SESSION_ID:-unknown}"

# Extract details for the notification
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)
COMMAND=$(echo "$INPUT" | grep -o '"command":"[^"]*"' | head -1 | cut -d'"' -f4 | head -c 60)

# Build description
DESCRIPTION=""
case "$TOOL_NAME" in
  Bash)
    DESCRIPTION="Run command: ${COMMAND}"
    ;;
  Write)
    DESCRIPTION="Write file: $(basename "$FILE_PATH" 2>/dev/null)"
    ;;
  Edit)
    DESCRIPTION="Edit file: $(basename "$FILE_PATH" 2>/dev/null)"
    ;;
  *)
    # Don't notify for reads, greps, etc
    exit 0
    ;;
esac

# Send notification (non-blocking)
curl -s -m 2 -X POST "${NEON_CITY_URL}/api/notification" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"approval-needed\",\"agentId\":\"${AGENT_ID}\",\"toolName\":\"${TOOL_NAME}\",\"description\":\"${DESCRIPTION}\",\"timestamp\":$(date +%s000)}" \
  > /dev/null 2>&1 &

exit 0
