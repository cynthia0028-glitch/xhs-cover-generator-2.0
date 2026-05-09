@echo off
cd /d "%~dp0"
echo Starting XHS cover generator...
echo.
echo Open this URL after the server starts:
echo http://localhost:3000
echo.

set "NODE_EXE="

where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE_EXE=node"
) else (
  if exist "%LOCALAPPDATA%\OpenAI\Codex\bin\node.exe" (
    set "NODE_EXE=%LOCALAPPDATA%\OpenAI\Codex\bin\node.exe"
  ) else (
    if exist "C:\Users\xujia\AppData\Local\OpenAI\Codex\bin\node.exe" (
      set "NODE_EXE=C:\Users\xujia\AppData\Local\OpenAI\Codex\bin\node.exe"
    )
  )
)

if "%NODE_EXE%"=="" (
  echo Node.js was not found on this computer.
  echo.
  echo Please install Node.js from:
  echo https://nodejs.org/
  echo.
  echo After installing, double-click this file again.
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" server.js
pause
