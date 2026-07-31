# verify.ps1 (v2.1) -- Objective verification gate (Harness-First Standard, Rule 5)
# Runs every check the repo defines, writes the RAW log to /harness/evidence/,
# exits non-zero if anything fails. A session is not "done" until this passes.
#
# Usage:  .\scripts\verify.ps1 -SessionId S-003
#         .\scripts\verify.ps1                    (ad hoc / Tier 1)

param(
    [string]$SessionId = "adhoc"
)

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# Non-interactive, no ANSI color -- keeps test runners honest in automation
$env:CI = "true"
$env:FORCE_COLOR = "0"
$env:NO_COLOR = "1"

$stamp   = Get-Date -Format "yyyy-MM-dd_HHmm"
$evDir   = Join-Path $repoRoot "harness\evidence"
New-Item -ItemType Directory -Force -Path $evDir | Out-Null
$logPath = Join-Path $evDir "$SessionId-verify-$stamp.log"

$script:failed = 0
$script:ran    = 0

Add-Content $logPath "VERIFICATION RUN -- session $SessionId -- $stamp"
Add-Content $logPath "Repo: $repoRoot"
Write-Host "Verification run: $SessionId ($stamp)"
Write-Host "Log: $logPath"

function Run-Check($name, $command) {
    $script:ran++
    Write-Host ("[{0}] running: {1} ..." -f $name, $command) -NoNewline
    Add-Content $logPath ""
    Add-Content $logPath "=== CHECK: $name ==="
    Add-Content $logPath ">> $command"

    $tmp = [System.IO.Path]::GetTempFileName()
    cmd /c "$command > `"$tmp`" 2>&1"
    $exit = $LASTEXITCODE
    Get-Content $tmp -ErrorAction SilentlyContinue | Add-Content $logPath
    Remove-Item $tmp -ErrorAction SilentlyContinue

    if ($exit -ne 0) {
        $script:failed++
        Add-Content $logPath "*** FAILED: $name (exit $exit) ***"
        Write-Host " FAILED (exit $exit)" -ForegroundColor Red
    } else {
        Add-Content $logPath "--- passed: $name ---"
        Write-Host " passed" -ForegroundColor Green
    }
}

# ---------- Node / Next.js projects ----------
if (Test-Path "package.json") {
    $pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
    $scripts = @{}
    if ($pkg.scripts) { $pkg.scripts.PSObject.Properties | ForEach-Object { $scripts[$_.Name] = $_.Value } }

    if ($scripts.ContainsKey("lint"))      { Run-Check "lint"      "npm run lint" }
    if ($scripts.ContainsKey("typecheck")) { Run-Check "typecheck" "npm run typecheck" }
    elseif (Test-Path "tsconfig.json")     { Run-Check "typecheck" "npx tsc --noEmit" }
    if ($scripts.ContainsKey("test"))      { Run-Check "tests"     "npm test -- --run" }
    # The test floor as a MACHINE check, not a sentence in a document. Reads the
    # vitest summary out of THIS run's log and compares it to harness/TEST_FLOOR.
    # Fails closed if the summary is missing or unparseable. See DECISIONS.md R-006:
    # the count fell 710 -> 707 across a commit and no gate noticed.
    if ($scripts.ContainsKey("test"))      { Run-Check "test-floor" "node scripts/check-test-floor.mjs `"$logPath`"" }
    if ($scripts.ContainsKey("test:e2e"))  { Run-Check "e2e"       "npm run test:e2e" }
    if ($scripts.ContainsKey("build"))     { Run-Check "build"     "npm run build" }
}

# ---------- Python projects ----------
if ((Test-Path "pyproject.toml") -or (Test-Path "requirements.txt")) {
    if (Get-Command ruff -ErrorAction SilentlyContinue)   { Run-Check "ruff"   "ruff check ." }
    if (Get-Command pytest -ErrorAction SilentlyContinue) { Run-Check "pytest" "pytest -q" }
}

# ---------- Result ----------
Add-Content $logPath ""
Add-Content $logPath "================================================"
if ($script:ran -eq 0) {
    Add-Content $logPath "RESULT: NO CHECKS CONFIGURED"
    Write-Host "RESULT: NO CHECKS CONFIGURED -- this repo cannot prove anything about itself yet. Add lint/typecheck/test/build scripts." -ForegroundColor Yellow
    exit 2
}
elseif ($script:failed -gt 0) {
    Add-Content $logPath "RESULT: FAILED -- $script:failed of $script:ran checks failed."
    Write-Host "RESULT: FAILED -- $script:failed of $script:ran checks failed. Evidence: $logPath" -ForegroundColor Red
    exit 1
}
else {
    Add-Content $logPath "RESULT: ALL CHECKS PASSED ($script:ran/$script:ran)."
    Write-Host "RESULT: ALL CHECKS PASSED ($script:ran/$script:ran). Evidence: $logPath" -ForegroundColor Green
    exit 0
}
