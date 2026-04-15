# =============================================================
# create-onenote-workflows.ps1
# Creates IT Workflows OneNote notebook in SharePoint site
# with Cisco Phone Install and Autopilot checklist pages
# =============================================================

$TenantId     = "e876d5db-a9f8-4e71-abc1-dcee4d8b0578"
$ClientId     = "9c823e8e-5ce1-480c-8240-e19f6b23512e"
$ClientSecret = "pMN8Q~7qNKr6pjEc4j9FLTHBA74rH.CwjwnjmbAg"
$SiteHost     = "claudeitagent.sharepoint.com"
$SiteName     = "ITKnowledgeBase"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " Claude IT Agent - OneNote Workflow Creator     " -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

function Get-Token {
    $body = "grant_type=client_credentials&client_id=$ClientId&client_secret=$([Uri]::EscapeDataString($ClientSecret))&scope=https://graph.microsoft.com/.default"
    $r = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" -ContentType "application/x-www-form-urlencoded" -Body $body
    return $r.access_token
}

function Graph-Get($path) {
    $t = Get-Token
    return Invoke-RestMethod -Method Get -Uri "https://graph.microsoft.com/v1.0$path" -Headers @{Authorization="Bearer $t"}
}

function Graph-Post($path, $body, $contentType) {
    $t = Get-Token
    $ct = if ($contentType) { $contentType } else { "application/json" }
    $b = if ($contentType) { $body } else { $body | ConvertTo-Json -Depth 10 }
    return Invoke-RestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0$path" -Headers @{Authorization="Bearer $t";"Content-Type"=$ct} -Body $b
}

# Get site ID
Write-Host ""
Write-Host "[1/6] Getting SharePoint site..." -ForegroundColor Yellow
$site = Graph-Get "/sites/${SiteHost}:/sites/${SiteName}:"
$siteId = $site.id
Write-Host "      Site ID: $siteId" -ForegroundColor Green

# Create or find IT Workflows notebook
Write-Host "[2/6] Creating IT Workflows notebook..." -ForegroundColor Yellow
try {
    $nb = Graph-Post "/sites/$siteId/onenote/notebooks" @{displayName="IT Workflows"}
    $nbId = $nb.id
    $nbUrl = $nb.links.oneNoteWebUrl.href
    Write-Host "      Created notebook: IT Workflows" -ForegroundColor Green
} catch {
    Write-Host "      Notebook may exist - fetching..." -ForegroundColor Yellow
    $nbs = Graph-Get "/sites/$siteId/onenote/notebooks"
    $nb = $nbs.value | Where-Object { $_.displayName -eq "IT Workflows" } | Select-Object -First 1
    $nbId = $nb.id
    $nbUrl = $nb.links.oneNoteWebUrl.href
    Write-Host "      Found notebook: IT Workflows" -ForegroundColor Green
}

# Create sections
Write-Host "[3/6] Creating sections..." -ForegroundColor Yellow
$ciscoSection = Graph-Post "/sites/$siteId/onenote/notebooks/$nbId/sections" @{displayName="Cisco Phone Installs"}
$autopilotSection = Graph-Post "/sites/$siteId/onenote/notebooks/$nbId/sections" @{displayName="Autopilot Deployments"}
Write-Host "      Cisco Phone Installs section created" -ForegroundColor Green
Write-Host "      Autopilot Deployments section created" -ForegroundColor Green

# Cisco Phone Install page
Write-Host "[4/6] Creating Cisco Phone Install checklist page..." -ForegroundColor Yellow
$ciscoHtml = @"
<!DOCTYPE html>
<html><head><title>Cisco IP Phone Installation</title></head><body>
<h1>Cisco IP Phone Installation</h1>
<table border="1"><tr><td><b>Date</b></td><td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td><td><b>Tech</b></td><td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td></tr>
<tr><td><b>Site</b></td><td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td><td><b>Extension</b></td><td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td></tr></table>
<h2>Phase 1 - Pre-Installation Checks</h2>
<p data-tag="to-do">Unbox phone and verify model matches work order</p>
<p data-tag="to-do">Confirm MAC address matches deployment sheet</p>
<p data-tag="to-do">Check PoE switch port is active and tagged to voice VLAN</p>
<p data-tag="to-do">Verify DHCP scope has available IPs on voice VLAN</p>
<p data-tag="to-do">Confirm CUCM has device profile ready for this MAC</p>
<p data-tag="to-do">Check correct extension (DN) is pre-configured in CUCM</p>
<h2>Phase 2 - Physical Installation</h2>
<p data-tag="to-do">Mount bracket and place phone on desk or wall</p>
<p data-tag="to-do">Connect ethernet cable to PoE switch port</p>
<p data-tag="to-do">Connect handset cable to phone base</p>
<p data-tag="to-do">Power on - confirm boot screen appears</p>
<p data-tag="to-do">Note IP address displayed during boot</p>
<h2>Phase 3 - Phone Registration</h2>
<p data-tag="to-do">Confirm phone registers in CUCM (Device &gt; Phone, search by MAC)</p>
<p data-tag="to-do">Verify correct extension shown on phone screen</p>
<p data-tag="to-do">Test internal call - confirm audio both directions</p>
<p data-tag="to-do">Test external call via PSTN - confirm audio both directions</p>
<p data-tag="to-do">Confirm voicemail button routes correctly</p>
<h2>Phase 4 - Configuration</h2>
<p data-tag="to-do">Set correct time zone (Settings &gt; User Preferences &gt; Time Zone)</p>
<p data-tag="to-do">Configure speed dials per user request</p>
<p data-tag="to-do">Test intercom and call pickup group if configured</p>
<p data-tag="to-do">Verify BLF keys if applicable</p>
<p data-tag="to-do">Label phone with extension and user name</p>
<h2>Phase 5 - Sign-Off</h2>
<p data-tag="to-do">User confirmed phone is working</p>
<p data-tag="to-do">Photo taken of installation</p>
<p data-tag="to-do">Work order updated: MAC, IP, extension, switch port, location</p>
<p data-tag="to-do">Post to Teams IT channel: Cisco phone install complete - [Site] - Ext [XXXX] - [Tech]</p>
</body></html>
"@
$ciscoPage = Graph-Post "/sites/$siteId/onenote/sections/$($ciscoSection.id)/pages" $ciscoHtml "application/xhtml+xml"
Write-Host "      Cisco page created" -ForegroundColor Green

# Autopilot page
Write-Host "[5/6] Creating Autopilot Deployment checklist page..." -ForegroundColor Yellow
$autopilotHtml = @"
<!DOCTYPE html>
<html><head><title>Microsoft Autopilot Deployment</title></head><body>
<h1>Microsoft Autopilot Deployment</h1>
<table border="1"><tr><td><b>Date</b></td><td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td><td><b>Tech</b></td><td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td></tr>
<tr><td><b>Site</b></td><td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td><td><b>User</b></td><td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td></tr></table>
<h2>Phase 1 - Pre-Deployment Checks</h2>
<p data-tag="to-do">Confirm device serial number is registered in Intune/Autopilot portal</p>
<p data-tag="to-do">Verify Autopilot profile is assigned to device or group</p>
<p data-tag="to-do">Confirm user M365 licence is active and assigned</p>
<p data-tag="to-do">Confirm user MFA is configured and working</p>
<p data-tag="to-do">Check Wi-Fi or ethernet available at deployment site</p>
<h2>Phase 2 - Hardware Setup</h2>
<p data-tag="to-do">Unbox device and inspect for physical damage</p>
<p data-tag="to-do">Connect device to power</p>
<p data-tag="to-do">Power on and wait for Windows OOBE screen</p>
<p data-tag="to-do">Select correct region and keyboard layout</p>
<p data-tag="to-do">Confirm network connection shown</p>
<h2>Phase 3 - Autopilot Enrollment</h2>
<p data-tag="to-do">Enter user corporate email at sign-in screen</p>
<p data-tag="to-do">Wait for Autopilot profile to download (1-3 minutes)</p>
<p data-tag="to-do">Confirm organisation branding appears</p>
<p data-tag="to-do">Enter password and complete MFA</p>
<p data-tag="to-do">DO NOT interrupt - wait for all policies to apply (10-30 min)</p>
<h2>Phase 4 - Account Verification</h2>
<p data-tag="to-do">Sign in as end user - confirm desktop loads</p>
<p data-tag="to-do">Verify OneDrive sync starts automatically</p>
<p data-tag="to-do">Open Outlook - confirm mailbox loads</p>
<p data-tag="to-do">Open Teams - confirm correct account</p>
<p data-tag="to-do">Connect VPN - confirm it works</p>
<p data-tag="to-do">Check Intune compliance shows Compliant</p>
<h2>Phase 5 - Final Config</h2>
<p data-tag="to-do">Connect and test monitor, dock, peripherals</p>
<p data-tag="to-do">Map required network drives per user role</p>
<p data-tag="to-do">Run Windows Update - install pending updates</p>
<h2>Phase 6 - Sign-Off</h2>
<p data-tag="to-do">User confirmed device is working</p>
<p data-tag="to-do">Intune shows Compliant</p>
<p data-tag="to-do">Device name and serial recorded in work order</p>
<p data-tag="to-do">Old device collected - decommission ticket raised if applicable</p>
<p data-tag="to-do">Post to Teams IT channel: Autopilot deployment complete - [User] - [Site] - [Tech]</p>
</body></html>
"@
$autopilotPage = Graph-Post "/sites/$siteId/onenote/sections/$($autopilotSection.id)/pages" $autopilotHtml "application/xhtml+xml"
Write-Host "      Autopilot page created" -ForegroundColor Green

# Done
Write-Host "[6/6] Getting notebook URL..." -ForegroundColor Yellow
$finalNb = Graph-Get "/sites/$siteId/onenote/notebooks/$nbId"
$webUrl = $finalNb.links.oneNoteWebUrl.href

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " SUCCESS - OneNote Workflows Created            " -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host " Open in browser (works with work account):" -ForegroundColor Cyan
Write-Host " $webUrl" -ForegroundColor White
Write-Host ""
Write-Host " Or open in Teams:" -ForegroundColor Cyan
Write-Host " Teams > Claude IT Agent > Notes tab" -ForegroundColor White
Write-Host ""
Write-Host " Sections created:" -ForegroundColor Cyan
Write-Host "   - Cisco Phone Installs (with checkbox checklist)" -ForegroundColor White
Write-Host "   - Autopilot Deployments (with checkbox checklist)" -ForegroundColor White
Write-Host ""
