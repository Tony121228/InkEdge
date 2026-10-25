@echo off
setlocal
cd /d "%~dp0"

git status >nul 2>&1
if errorlevel 1 (
  echo This folder is not a Git repository.
  pause
  exit /b 1
)

git add -A

echo Checking staged files for sensitive information...
node scripts\pre-push-secret-scan.js
if errorlevel 1 (
  echo Sensitive information scan failed. Nothing was committed or pushed.
  pause
  exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 (
  echo No changes to commit. Trying to push existing commits...
  git push
  if errorlevel 1 (
    echo Push failed. Please check your network or GitHub login.
    pause
    exit /b 1
  )
  echo Updated to GitHub successfully.
  pause
  exit /b 0
)

set "COMMIT_MSG=Update %date% %time%"
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo Commit failed.
  pause
  exit /b 1
)

git push
if errorlevel 1 (
  echo Push failed. Please check your network or GitHub login.
  pause
  exit /b 1
)

echo Updated to GitHub successfully.
pause
