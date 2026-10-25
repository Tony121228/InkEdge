@echo off
setlocal EnableExtensions

chcp 65001 >nul
cd /d "%~dp0"

set "WORKER_NAME=inkedge"
set "D1_DATABASE=inkedge-state"
set "APP_URL=https://inkedge.aicreatorhome.cn"
set "HEALTH_URL=%APP_URL%/health"
set "SKIP_TESTS=0"
set "CHECK_ONLY=0"
set "HELP_EXIT_CODE=0"
set "SECRET_LIST_FILE=%TEMP%\%WORKER_NAME%-secret-list-%RANDOM%.json"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--skip-tests" (
  set "SKIP_TESTS=1"
  shift
  goto parse_args
)
if /I "%~1"=="--check-only" (
  set "CHECK_ONLY=1"
  shift
  goto parse_args
)
if /I "%~1"=="--help" goto help
echo Unknown option: %~1
set "HELP_EXIT_CODE=2"
goto help

:args_done
echo.
echo ==========================================
echo InkEdge one-click deployment
echo Worker: %WORKER_NAME%
echo D1:     %D1_DATABASE%
echo URL:    %APP_URL%
echo ==========================================
echo.

call :require_cmd node
if errorlevel 1 goto failed
call :require_cmd npm
if errorlevel 1 goto failed

if not exist "package.json" (
  echo [ERROR] package.json was not found. Please run this script from the project root.
  goto failed
)

if not exist "wrangler.jsonc" (
  echo [ERROR] wrangler.jsonc was not found. Please run this script from the project root.
  goto failed
)

if not exist "node_modules" (
  echo.
  echo [STEP] Install dependencies
  call npm install
  if errorlevel 1 goto failed
  echo [OK] Install dependencies
)

echo.
echo [STEP] Check Cloudflare login
call npx wrangler whoami
if errorlevel 1 goto failed
echo [OK] Check Cloudflare login

echo.
echo [STEP] Check required Cloudflare Secret names
call npx wrangler secret list --name "%WORKER_NAME%" --format json > "%SECRET_LIST_FILE%"
if errorlevel 1 goto failed
call node scripts/check-cloudflare-secrets.js "%SECRET_LIST_FILE%"
set "SECRET_CHECK_EXIT=%ERRORLEVEL%"
del /q "%SECRET_LIST_FILE%" >nul 2>nul
if not "%SECRET_CHECK_EXIT%"=="0" goto failed
echo [OK] Required Cloudflare Secret names are present

echo.
echo [STEP] Check server syntax
call node --check server.js
if errorlevel 1 goto failed
echo [OK] Check server syntax

if "%CHECK_ONLY%"=="1" (
  echo.
  echo [STEP] Validate Worker deployment package
  call npx wrangler deploy --dry-run
  if errorlevel 1 goto failed
  echo [OK] Validate Worker deployment package
  echo.
  echo [OK] Check-only mode finished. No deployment was published.
  goto success
)

if not "%SKIP_TESTS%"=="1" (
  echo.
  echo [STEP] Run 7-day training plan test
  call npm run test:training-plan-7d
  if errorlevel 1 goto failed
  echo [OK] Run 7-day training plan test

  echo.
  echo [STEP] Run short guidance frontend test
  call npm run test:short-guidance-frontend
  if errorlevel 1 goto failed
  echo [OK] Run short guidance frontend test

  echo.
  echo [STEP] Run auth API smoke test
  call npm run test:auth-api-smoke
  if errorlevel 1 goto failed
  echo [OK] Run auth API smoke test
) else (
  echo [INFO] Tests skipped by --skip-tests.
)

echo.
echo [STEP] Apply remote D1 migrations
call npx wrangler d1 migrations apply %D1_DATABASE% --remote
if errorlevel 1 goto failed
echo [OK] Apply remote D1 migrations

echo.
echo [STEP] Validate Worker deployment package
call npx wrangler deploy --dry-run
if errorlevel 1 goto failed
echo [OK] Validate Worker deployment package

echo.
echo [STEP] Deploy Worker to Cloudflare
call npx wrangler deploy
if errorlevel 1 goto failed
echo [OK] Deploy Worker to Cloudflare

echo.
echo [STEP] Check online health endpoint
call node -e "fetch(process.env.HEALTH_URL).then(async r=>{const t=await r.text(); console.log(r.status); console.log(t); if(!r.ok || !t.includes('\"app\":\"inkedge\"')) process.exit(1)}).catch(e=>{console.error(e.message); process.exit(1)})"
if errorlevel 1 goto failed
echo [OK] Check online health endpoint

goto success

:require_cmd
where "%~1" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Required command not found: %~1
  exit /b 1
)
exit /b 0

:success
echo.
echo ==========================================
echo Deployment workflow completed.
echo %APP_URL%
echo ==========================================
if not "%NO_PAUSE%"=="1" pause
exit /b 0

:failed
echo.
echo ==========================================
echo Deployment workflow failed.
echo Fix the error above, then run "%~nx0" again.
echo ==========================================
if not "%NO_PAUSE%"=="1" pause
exit /b 1

:help
echo.
echo Usage:
echo   "%~nx0"
echo   "%~nx0" --skip-tests
echo   "%~nx0" --check-only
echo.
echo Options:
echo   --skip-tests   Deploy without running local smoke tests.
echo   --check-only   Validate local config and Cloudflare package without publishing.
echo.
if not "%NO_PAUSE%"=="1" pause
exit /b %HELP_EXIT_CODE%
