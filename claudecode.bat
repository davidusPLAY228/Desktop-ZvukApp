@echo off
setlocal

set "ANTHROPIC_AUTH_TOKEN=sk-0682111942e57645-2d86db-bc79fcbe"
set "ANTHROPIC_BASE_URL=http://localhost:20129/v1"
set "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1"
set "ANTHROPIC_MODEL=kr/claude-sonnet-4.5"
echo Starting Claude Code via OmniRoute...
claude

endlocal