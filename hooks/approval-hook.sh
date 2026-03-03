#!/usr/bin/env bash
# Neon City — Blocking Approval Hook for Claude Code
# Sends approval requests to Neon City server and waits for user decision.
# Install: Add to .claude/settings.local.json hooks.PreToolUse
#
# Returns JSON to Claude Code:
#   {"decision": "allow"}  — user approved
#   {"decision": "deny", "reason": "User denied in Neon City"}  — user denied

NEON_CITY_URL="${NEON_CITY_URL:-http://localhost:5174}"
MAX_WAIT=120  # seconds

# Read event JSON from stdin
INPUT=$(cat)

# Parse with python for reliability
eval "$(echo "$INPUT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'TOOL_NAME=\"{d.get(\"tool_name\",\"\")}\"')
print(f'SESSION_ID=\"{d.get(\"session_id\",\"\")}\"')
print(f'HOOK_TYPE=\"{d.get(\"hook_type\",\"\")}\"')
inp=d.get('tool_input',{})
if isinstance(inp,dict):
  fp=inp.get('file_path','') or inp.get('path','')
  cmd=(inp.get('command','') or '')[:60]
  print(f'FILE_PATH=\"{fp}\"')
  print(f'COMMAND=\"{cmd}\"')
else:
  print('FILE_PATH=\"\"')
  print('COMMAND=\"\"')
" 2>/dev/null)" 2>/dev/null

# Only block on PreToolUse
if [ "$HOOK_TYPE" != "PreToolUse" ]; then
  exit 0
fi

# Only require approval for destructive tools
case "$TOOL_NAME" in
  Bash|Write|Edit|NotebookEdit)
    ;;
  *)
    # Allow reads, greps, globs, etc without approval
    exit 0
    ;;
esac

AGENT_ID="${SESSION_ID:-unknown}"

# Build description
case "$TOOL_NAME" in
  Bash)   DESC="Run: ${COMMAND}" ;;
  Write)  DESC="Write: $(basename "$FILE_PATH" 2>/dev/null)" ;;
  Edit)   DESC="Edit: $(basename "$FILE_PATH" 2>/dev/null)" ;;
  *)      DESC="${TOOL_NAME}" ;;
esac

# POST approval request
RESPONSE=$(curl -s -m 5 -X POST "${NEON_CITY_URL}/api/approval/request" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"${AGENT_ID}\",\"toolName\":\"${TOOL_NAME}\",\"toolInput\":\"${FILE_PATH:-$COMMAND}\",\"description\":\"${DESC}\"}")

# Check if auto-approved
DECISION=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('decision',''))" 2>/dev/null)
if [ "$DECISION" = "approve" ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

APPROVAL_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

if [ -z "$APPROVAL_ID" ]; then
  # Server unreachable or error — allow by default
  exit 0
fi

# Poll for decision
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  WAIT_RESPONSE=$(curl -s -m 35 "${NEON_CITY_URL}/api/approval/${APPROVAL_ID}/wait?timeout=30000")
  WAIT_DECISION=$(echo "$WAIT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('decision',''))" 2>/dev/null)

  if [ "$WAIT_DECISION" = "approved" ]; then
    echo '{"decision":"allow"}'
    exit 0
  elif [ "$WAIT_DECISION" = "denied" ]; then
    echo '{"decision":"deny","reason":"User denied in Neon City"}'
    exit 0
  fi

  ELAPSED=$((ELAPSED + 30))
done

# Timeout — allow by default (don't block indefinitely)
echo '{"decision":"allow"}'
exit 0
