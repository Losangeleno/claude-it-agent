# deploy.ps1 — Rebuild and redeploy Claude IT Agent to Azure Container Apps
# Run: powershell -ExecutionPolicy Bypass -File "C:\claude-it-agent\deploy.ps1"

$ResourceGroup = "claude-it-agent-rg"
$ContainerAppName = "claude-it-agent"
$Location = "eastus"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Claude IT Agent - Azure Redeploy          " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check Azure CLI is installed
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "Azure CLI not found. Installing..." -ForegroundColor Yellow
    winget install Microsoft.AzureCLI
    Write-Host "Restart PowerShell after install, then re-run this script." -ForegroundColor Yellow
    exit 1
}
Write-Host "[1/5] Azure CLI found." -ForegroundColor Green

# Login check
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "[2/5] Logging in to Azure..." -ForegroundColor Yellow
    az login
} else {
    Write-Host "[2/5] Already logged in as $($account.user.name)" -ForegroundColor Green
}

# Get the container registry used by the Container App
Write-Host ""
Write-Host "[3/5] Finding container registry..." -ForegroundColor Yellow
$appDetails = az containerapp show --name $ContainerAppName --resource-group $ResourceGroup 2>$null | ConvertFrom-Json
if (-not $appDetails) {
    Write-Host "ERROR: Could not find Container App '$ContainerAppName' in resource group '$ResourceGroup'" -ForegroundColor Red
    Write-Host "Check the resource group name in Azure Portal and update this script." -ForegroundColor Yellow
    exit 1
}

$imageRef = $appDetails.properties.template.containers[0].image
$registry = ($imageRef -split "/")[0]
Write-Host "     Registry: $registry" -ForegroundColor Green
Write-Host "     Image: $imageRef" -ForegroundColor Green

# Login to registry
Write-Host ""
Write-Host "[4/5] Building and pushing new image..." -ForegroundColor Yellow
Set-Location "C:\claude-it-agent"

az acr login --name ($registry -replace "\.azurecr\.io","")

$tag = "latest"
$newImage = $imageRef -replace ":.*$", ":$tag"

# Build using ACR build (no local Docker needed)
az acr build --registry ($registry -replace "\.azurecr\.io","") --image ($newImage -replace "^[^/]+/","") .

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed." -ForegroundColor Red
    exit 1
}
Write-Host "     Build complete." -ForegroundColor Green

# Update the Container App to use new image
Write-Host ""
Write-Host "[5/5] Updating Container App..." -ForegroundColor Yellow
az containerapp update --name $ContainerAppName --resource-group $ResourceGroup --image $newImage

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host " SUCCESS - Deployment complete              " -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host " App URL: https://$ContainerAppName.whitestone-6cbe99bc.$Location.azurecontainerapps.io/chat" -ForegroundColor Cyan
    Write-Host " Wait 30 seconds then refresh the browser." -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "ERROR: Container App update failed. Check Azure Portal." -ForegroundColor Red
}
