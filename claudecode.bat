@echo off
setlocal

set "ANTHROPIC_AUTH_TOKEN=sk-0682111942e57645-2d86db-bc79fcbe"
set "ANTHROPIC_BASE_URL=http://localhost:20129/v1"
set "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1"

echo Available models:
echo 1) oc/deepseek-v4-flash-free
echo 2) kr/glm-5
echo 3) kr/claude-sonnet-4.5
echo 4) Custom...
set /p choice="Select model (1-4): "

if "%choice%"=="1" set "ANTHROPIC_MODEL=oc/deepseek-v4-flash-free"
if "%choice%"=="2" set "ANTHROPIC_MODEL=kr/glm-5"
if "%choice%"=="3" set "ANTHROPIC_MODEL=kr/claude-sonnet-4.5"
if "%choice%"=="4" (
    set /p custom="Enter model name: "
    set "ANTHROPIC_MODEL=%custom%"
)

echo Starting Claude Code with model: %ANTHROPIC_MODEL%
claude

endlocal