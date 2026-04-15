# =============================================================
# setup-teams-and-workflows.ps1
# Configures:
#   1. IT Agent tab in Teams General channel
#   2. Cisco Phone Install checklist in SharePoint
#   3. Autopilot Deployment checklist in SharePoint
#
# Run: powershell -ExecutionPolicy Bypass -File "C:\claude-it-agent\setup-teams-and-workflows.ps1"
# =============================================================

$TenantId        = "e876d5db-a9f8-4e71-abc1-dcee4d8b0578"
$ClientId        = "9c823e8e-5ce1-480c-8240-e19f6b23512e"
$ClientSecret    = "pMN8Q~7qNKr6pjEc4j9FLTHBA74rH.CwjwnjmbAg"
$TeamId          = "1dede829-35a4-4d2b-96d4-ab4687aa13a5"
$ChannelId       = "19:h3O1iQ3KfOuqLoQKUtbWEa2lLMqHBwjX1qTlTK0lrqw1@thread.tacv2"
$WebAppUrl       = "https://claude-it-agent.whitestone-6cbe99bc.eastus.azurecontainerapps.io/chat"
$SharePointSite  = "claudeitagent.sharepoint.com"
$KBSiteName      = "ITKnowledgeBase"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " Claude IT Agent - Teams + Workflow Setup       " -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# --- Get Graph token ---
function Get-GraphToken {
    $body = "grant_type=client_credentials&client_id=$ClientId&client_secret=$([Uri]::EscapeDataString($ClientSecret))&scope=https://graph.microsoft.com/.default"
    $response = Invoke-RestMethod -Method Post `
        -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" `
        -ContentType "application/x-www-form-urlencoded" `
        -Body $body
    return $response.access_token
}

function Invoke-Graph {
    param($Method, $Path, $Body)
    $token = Get-GraphToken
    $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
    if ($Body) {
        return Invoke-RestMethod -Method $Method -Uri "https://graph.microsoft.com/v1.0$Path" -Headers $headers -Body ($Body | ConvertTo-Json -Depth 10)
    }
    return Invoke-RestMethod -Method $Method -Uri "https://graph.microsoft.com/v1.0$Path" -Headers $headers
}

# =============================================================
# STEP 1: Add IT Agent tab to Teams General channel
# =============================================================
Write-Host ""
Write-Host "[1/3] Adding IT Agent tab to Teams General channel..." -ForegroundColor Yellow

try {
    $tabBody = @{
        displayName = "IT Agent"
        "teamsApp@odata.bind" = "https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/com.microsoft.teamspace.tab.web"
        configuration = @{
            entityId   = "it-agent-tab"
            contentUrl = $WebAppUrl
            websiteUrl = $WebAppUrl
            removeUrl  = ""
        }
    }
    $result = Invoke-Graph -Method Post -Path "/teams/$TeamId/channels/$ChannelId/tabs" -Body $tabBody
    Write-Host "      Tab created: $($result.displayName)" -ForegroundColor Green
    Write-Host "      URL: $WebAppUrl" -ForegroundColor Green
} catch {
    Write-Host "      Tab may already exist or requires additional permissions." -ForegroundColor Yellow
    Write-Host "      Error: $($_.Exception.Message)" -ForegroundColor Yellow
}

# =============================================================
# STEP 2: Upload Cisco Phone Install workflow to SharePoint
# =============================================================
Write-Host ""
Write-Host "[2/3] Uploading Cisco Phone Install workflow checklist..." -ForegroundColor Yellow

$ciscoChecklist = @"
# RB-010 - Cisco IP Phone Installation Checklist
**Date:** ___________  **Tech:** ___________  **Site:** ___________  **Ext:** ___________

---

## Phase 1 - Pre-Installation Checks
- [ ] Unbox phone and verify model matches work order
- [ ] Confirm MAC address matches deployment sheet
- [ ] Check PoE switch port is active and tagged to voice VLAN
- [ ] Verify DHCP scope has available IPs on voice VLAN
- [ ] Confirm CUCM has device profile ready for this MAC
- [ ] Check correct extension (DN) is pre-configured in CUCM

## Phase 2 - Physical Installation
- [ ] Mount bracket and place phone on desk or wall
- [ ] Connect ethernet cable to PoE switch port
- [ ] Connect handset cable to phone base
- [ ] Power on - confirm boot screen appears
- [ ] Note IP address displayed during boot: ___________

## Phase 3 - Phone Registration
- [ ] Confirm phone registers in CUCM (Device > Phone, search by MAC)
- [ ] Verify correct extension shown on phone screen
- [ ] Test internal call - confirm audio both directions
- [ ] Test external call via PSTN - confirm audio both directions
- [ ] Confirm voicemail button routes correctly

## Phase 4 - Configuration
- [ ] Set correct time zone (Settings > User Preferences > Time Zone)
- [ ] Configure speed dials per user request
- [ ] Test intercom and call pickup group if configured
- [ ] Verify BLF keys if applicable
- [ ] Label phone with extension and user name

## Phase 5 - Sign-Off
- [ ] User confirmed phone is working
- [ ] Photo taken of installation
- [ ] Work order updated: MAC, IP, extension, switch port, location
- [ ] Completion posted to Teams IT channel: CHECK Cisco phone install complete - [Site] - Ext [XXXX] - [Tech]

---
**Source:** RB-010 - Cisco IP Phone Installation
"@

try {
    # Get site ID
    $site = Invoke-Graph -Method Get -Path "/sites/${SharePointSite}:/sites/${KBSiteName}:"
    $siteId = $site.id

    # Get Runbooks drive
    $drives = Invoke-Graph -Method Get -Path "/sites/$siteId/drives"
    $runbooksDrive = $drives.value | Where-Object { $_.name -eq "Runbooks" } | Select-Object -First 1

    if ($runbooksDrive) {
        $token = Get-GraphToken
        $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "text/plain; charset=utf-8" }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($ciscoChecklist)
        Invoke-RestMethod -Method Put `
            -Uri "https://graph.microsoft.com/v1.0/drives/$($runbooksDrive.id)/root:/RB-010-Cisco-Phone-Checklist.md:/content" `
            -Headers $headers -Body $bytes | Out-Null
        Write-Host "      Uploaded: RB-010-Cisco-Phone-Checklist.md" -ForegroundColor Green
    } else {
        Write-Host "      Runbooks library not found" -ForegroundColor Yellow
    }
} catch {
    Write-Host "      Error: $($_.Exception.Message)" -ForegroundColor Yellow
}

# =============================================================
# STEP 3: Upload Autopilot workflow to SharePoint
# =============================================================
Write-Host ""
Write-Host "[3/3] Uploading Autopilot Deployment workflow checklist..." -ForegroundColor Yellow

$autopilotChecklist = @"
# RB-011 - Microsoft Autopilot Deployment Checklist
**Date:** ___________  **Tech:** ___________  **Site:** ___________  **User:** ___________

---

## Phase 1 - Pre-Deployment Checks (Do Before Going On Site)
- [ ] Confirm device serial number is registered in Intune/Autopilot portal
- [ ] Verify Autopilot deployment profile is assigned to device or group
- [ ] Confirm user M365 licence is active and assigned
- [ ] Confirm user MFA is configured and working
- [ ] Check Wi-Fi or ethernet is available at deployment site
- [ ] Confirm required apps are in the Autopilot deployment group

## Phase 2 - Hardware Setup
- [ ] Unbox device and inspect for physical damage
- [ ] Connect device to power
- [ ] Connect ethernet cable if Wi-Fi not reliable for enrollment
- [ ] Power on and wait for Windows OOBE screen
- [ ] Select correct region and keyboard layout
- [ ] Confirm network connection shown - DO NOT skip

## Phase 3 - Autopilot Enrollment
- [ ] Enter user corporate email address at sign-in screen
- [ ] Wait for Autopilot profile to download (1-3 minutes)
- [ ] Confirm organisation branding and setup message appears
- [ ] Enter user password and complete MFA
- [ ] DO NOT interrupt - wait for policies and apps to apply (10-30 min)
- [ ] Monitor Company Portal for app installation progress

## Phase 4 - Account and Policy Verification
- [ ] Sign in as end user - confirm desktop loads
- [ ] Verify OneDrive sync starts automatically
- [ ] Open Outlook - confirm mailbox loads
- [ ] Open Teams - confirm correct account
- [ ] Connect VPN - confirm it works
- [ ] Check Intune compliance shows Compliant

## Phase 5 - Peripherals and Final Config
- [ ] Connect and test monitor, docking station, peripherals
- [ ] Map required network drives per user role
- [ ] Confirm all required apps installed from Company Portal
- [ ] Run Windows Update - install pending updates
- [ ] Set accessibility settings per user preference

## Phase 6 - Sign-Off
- [ ] User confirmed device is working
- [ ] Intune shows Compliant
- [ ] Device name and serial recorded in work order
- [ ] Old device collected - decommission ticket raised if applicable
- [ ] Completion posted to Teams IT channel: CHECK Autopilot deployment complete - [User] - [Site] - [Tech]

---
**Source:** RB-011 - Microsoft Autopilot Device Deployment
"@

try {
    $token = Get-GraphToken
    $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "text/plain; charset=utf-8" }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($autopilotChecklist)
    $site = Invoke-Graph -Method Get -Path "/sites/${SharePointSite}:/sites/${KBSiteName}:"
    $drives = Invoke-Graph -Method Get -Path "/sites/$($site.id)/drives"
    $runbooksDrive = $drives.value | Where-Object { $_.name -eq "Runbooks" } | Select-Object -First 1

    if ($runbooksDrive) {
        Invoke-RestMethod -Method Put `
            -Uri "https://graph.microsoft.com/v1.0/drives/$($runbooksDrive.id)/root:/RB-011-Autopilot-Checklist.md:/content" `
            -Headers $headers -Body $bytes | Out-Null
        Write-Host "      Uploaded: RB-011-Autopilot-Checklist.md" -ForegroundColor Green
    }
} catch {
    Write-Host "      Error: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " Setup Complete                                 " -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host " Teams:" -ForegroundColor Cyan
Write-Host "   IT Agent tab added to General channel" -ForegroundColor White
Write-Host "   Field techs: open Teams > Claude IT Agent > IT Agent tab" -ForegroundColor White
Write-Host ""
Write-Host " SharePoint Checklists:" -ForegroundColor Cyan
Write-Host "   RB-010-Cisco-Phone-Checklist.md" -ForegroundColor White
Write-Host "   RB-011-Autopilot-Checklist.md" -ForegroundColor White
Write-Host "   Both searchable via the IT Agent" -ForegroundColor White
Write-Host ""
