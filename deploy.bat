@echo off
REM Double-click this file to deploy the extension.
REM Works from wherever the repo lives - no hardcoded paths.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
pause
