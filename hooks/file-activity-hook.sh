#!/usr/bin/env bash
# Neon City — File Activity Hook for Claude Code
# Captures file read/write/search events and sends to Neon City server

NEON_CITY_URL="${NEON_CITY_URL:-http://localhost:5174}"

# Read event JSON from stdin
INPUT=$(cat)

# Extract fields using python for reliable JSON parsing
eval "$(echo "$INPUT" | python3 -c "
import sys,json,os
d=json.load(sys.stdin)
print(f'TOOL_NAME=\"{d.get(\"tool_name\",\"\")}\"')
print(f'SESSION_ID=\"{d.get(\"session_id\",\"\")}\"')
print(f'HOOK_TYPE=\"{d.get(\"hook_type\",\"\")}\"')
inp=d.get('tool_input',{})
if isinstance(inp,dict):
  fp=inp.get('file_path','') or inp.get('path','')
  cmd=inp.get('command','')[:40] if inp.get('command') else ''
  print(f'FILE_PATH=\"{fp}\"')
  print(f'COMMAND=\"{cmd}\"')
else:
  print('FILE_PATH=\"\"')
  print('COMMAND=\"\"')
" 2>/dev/null)" 2>/dev/null

# Fallback: use CLAUDE_SESSION_ID env var
if [ -z "$SESSION_ID" ]; then
  SESSION_ID="${CLAUDE_SESSION_ID:-claude-$$}"
fi

AGENT_ID="$SESSION_ID"

# Determine activity type
case "$TOOL_NAME" in
  Read|Glob)
    if [ "$HOOK_TYPE" = "PreToolUse" ]; then TYPE="read-start"; else TYPE="read-end"; fi
    ;;
  Write|Edit|NotebookEdit)
    if [ "$HOOK_TYPE" = "PreToolUse" ]; then TYPE="write-start"; else TYPE="write-end"; fi
    ;;
  Grep)
    if [ "$HOOK_TYPE" = "PreToolUse" ]; then TYPE="search-start"; else TYPE="search-end"; fi
    ;;
  Bash)
    if [ "$HOOK_TYPE" = "PreToolUse" ]; then TYPE="bash-start"; else TYPE="bash-end"; fi
    [ -z "$FILE_PATH" ] && FILE_PATH="$COMMAND"
    ;;
  *)
    exit 0
    ;;
esac

# Send to server (non-blocking, 2s timeout)
curl -s -m 2 -X POST "${NEON_CITY_URL}/api/activity" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"${TYPE}\",\"filePath\":\"${FILE_PATH}\",\"agentId\":\"${AGENT_ID}\",\"source\":\"claude\",\"timestamp\":$(date +%s000)}" \
  > /dev/null 2>&1 &

exit 0
