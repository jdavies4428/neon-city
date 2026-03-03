#!/usr/bin/env bash
# Neon City — Thinking/Tool Hook for Claude Code
# Captures agent thinking state and tool execution details

NEON_CITY_URL="${NEON_CITY_URL:-http://localhost:5174}"

# Read event JSON from stdin
INPUT=$(cat)

# Extract fields using python for reliable JSON parsing
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session_id',''))" 2>/dev/null)
HOOK_TYPE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('hook_type',''))" 2>/dev/null)

# Fallback: use CLAUDE_SESSION_ID env var or generate from PID
if [ -z "$SESSION_ID" ]; then
  SESSION_ID="${CLAUDE_SESSION_ID:-claude-$$}"
fi

AGENT_ID="$SESSION_ID"

# Extract tool-specific input for display
TOOL_INPUT=""
case "$TOOL_NAME" in
  Read|Write|Edit|NotebookEdit)
    TOOL_INPUT=$(echo "$INPUT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
inp=d.get('tool_input',{})
if isinstance(inp,dict):
  p=inp.get('file_path','') or inp.get('path','')
  import os; print(os.path.basename(p) if p else '')
else: print('')" 2>/dev/null)
    ;;
  Bash)
    TOOL_INPUT=$(echo "$INPUT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
inp=d.get('tool_input',{})
if isinstance(inp,dict): print(inp.get('command','')[:40])
else: print('')" 2>/dev/null)
    ;;
  Grep|Glob)
    TOOL_INPUT=$(echo "$INPUT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
inp=d.get('tool_input',{})
if isinstance(inp,dict): print(inp.get('pattern','')[:30])
else: print('')" 2>/dev/null)
    ;;
  Agent)
    TOOL_INPUT=$(echo "$INPUT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
inp=d.get('tool_input',{})
if isinstance(inp,dict): print(inp.get('description','')[:30])
else: print('')" 2>/dev/null)
    ;;
esac

# Determine thinking type
if [ "$HOOK_TYPE" = "PreToolUse" ]; then
  TYPE="thinking-start"
else
  TYPE="thinking-end"
fi

# Send to server (non-blocking, 2s timeout)
curl -s -m 2 -X POST "${NEON_CITY_URL}/api/thinking" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"${TYPE}\",\"agentId\":\"${AGENT_ID}\",\"toolName\":\"${TOOL_NAME}\",\"toolInput\":\"${TOOL_INPUT}\",\"source\":\"claude\",\"timestamp\":$(date +%s000)}" \
  > /dev/null 2>&1 &

exit 0
