@echo off
setlocal DisableDelayedExpansion
set "PROCESSOR_SKILLS_ARG_TRANSPORT=windows-command-line-v1"
set "PROCESSOR_SKILLS_FIXED_COMMAND=read-text"
set "PROCESSOR_SKILLS_RAW_ARGUMENTS=%*"
call "%~dp0run.cmd"
set "PROCESSOR_SKILLS_EXIT_CODE=%ERRORLEVEL%"
exit /b %PROCESSOR_SKILLS_EXIT_CODE%
