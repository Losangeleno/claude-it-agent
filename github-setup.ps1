# github-setup.ps1
# Initialises git and pushes C:\claude-it-agent to your private GitHub repo
#
# Run with:
#   powershell -ExecutionPolicy Bypass -File "C:\claude-it-agent\github-setup.ps1"

$repoUrl = "https://github.com/LAngeleno/claude-it-agent.git"

Write-Host ""
Write-Host "========================================"
Write-Host " Claude IT Agent — GitHub Setup"
Write-Host "========================================"
Write-Host ""

# Check git is installed
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "❌  Git not found. Install it from https://git-scm.com and re-run." -ForegroundColor Red
  exit 1
}
Write-Host "✅  Git found." -ForegroundColor Green

Set-Location "C:\claude-it-agent"

# Initialise repo if not already done
if (-not (Test-Path ".git")) {
  Write-Host "Initialising git repo..." -ForegroundColor Cyan
  git init
  git branch -M main
} else {
  Write-Host "✅  Git already initialised." -ForegroundColor Green
}

# Set remote
$existingRemote = git remote 2>$null
if ($existingRemote -contains "origin") {
  git remote set-url origin $repoUrl
} else {
  git remote add origin $repoUrl
}
Write-Host "✅  Remote set to $repoUrl" -ForegroundColor Green

# Stage all files
Write-Host ""
Write-Host "Staging files..." -ForegroundColor Cyan
git add .

# Show what's being committed
Write-Host ""
Write-Host "Files to be committed:" -ForegroundColor Cyan
git status --short

# Commit
Write-Host ""
git commit -m "Initial commit — Claude IT Agent v1 (Phases 1, 2 & 5)"

# Push
Write-Host ""
Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
Write-Host "(A browser window may open asking you to sign in to GitHub)" -ForegroundColor Yellow
Write-Host ""
git push -u origin main

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "✅  All files pushed to https://github.com/LAngeleno/claude-it-agent" -ForegroundColor Green
  Write-Host ""
} else {
  Write-Host ""
  Write-Host "⚠️  Push failed. Make sure the repo exists at:" -ForegroundColor Yellow
  Write-Host "    https://github.com/LAngeleno/claude-it-agent" -ForegroundColor White
  Write-Host ""
  Write-Host "Then re-run this script." -ForegroundColor White
}
