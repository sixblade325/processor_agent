@echo off
setlocal DisableDelayedExpansion
if "%PROCESSOR_SKILLS_ARG_TRANSPORT%"=="windows-command-line-v1" goto launch
set "PROCESSOR_SKILLS_ARG_TRANSPORT=windows-command-line-v1"
set "PROCESSOR_SKILLS_FIXED_COMMAND="
set "PROCESSOR_SKILLS_RAW_ARGUMENTS=%*"
:launch
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
set "PROCESSOR_SKILLS_EXIT_CODE=%ERRORLEVEL%"
exit /b %PROCESSOR_SKILLS_EXIT_CODE%
