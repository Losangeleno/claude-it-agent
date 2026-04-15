$AppClientId = "9c823e8e-5ce1-480c-8240-e19f6b23512e"
$TenantId    = "e876d5db-a9f8-4e71-abc1-dcee4d8b0578"

Write-Host ""
Write-Host "============================================"
Write-Host " Claude IT Agent - Add OneNote Permission  "
Write-Host "============================================"
Write-Host ""

Write-Host "[1/5] Checking Microsoft Graph PowerShell module..."
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph)) {
    Write-Host "      Installing Microsoft.Graph module, please wait..."
    Install-Module Microsoft.Graph -Scope CurrentUser -Force -AllowClobber
    Write-Host "      Installed."
} else {
    Write-Host "      Already installed."
}

Write-Host ""
Write-Host "[2/5] Connecting to Microsoft Graph..."
Write-Host "      Sign in with your Global Admin account when the browser opens."
Write-Host ""
Connect-MgGraph -TenantId $TenantId -Scopes "Application.ReadWrite.All","AppRoleAssignment.ReadWrite.All" -ErrorAction Stop
Write-Host "      Connected."

Write-Host ""
Write-Host "[3/5] Finding your app and the OneNote permission..."

$app = Get-MgApplication -Filter "appId eq '$AppClientId'" -ErrorAction Stop
if (-not $app) {
    Write-Host "ERROR: Could not find app with Client ID $AppClientId"
    exit 1
}
Write-Host "      Found app: $($app.DisplayName)"

$graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'" -ErrorAction Stop
$notesRole = $graphSp.AppRoles | Where-Object { $_.Value -eq "Notes.ReadWrite.All" -and $_.AllowedMemberTypes -contains "Application" }

if (-not $notesRole) {
    Write-Host "ERROR: Could not find Notes.ReadWrite.All role"
    exit 1
}
Write-Host "      Found role: Notes.ReadWrite.All"

Write-Host ""
Write-Host "[4/5] Checking if permission already exists..."

$appSp = Get-MgServicePrincipal -Filter "appId eq '$AppClientId'" -ErrorAction Stop
$existing = Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $appSp.Id | Where-Object { $_.AppRoleId -eq $notesRole.Id }

if ($existing) {
    Write-Host "      Notes.ReadWrite.All already assigned."
} else {
    $currentAccess = $app.RequiredResourceAccess
    $graphResource = $currentAccess | Where-Object { $_.ResourceAppId -eq "00000003-0000-0000-c000-000000000000" }
    $newRole = @{ Id = $notesRole.Id; Type = "Role" }

    if ($graphResource) {
        $graphResource.ResourceAccess += $newRole
    } else {
        $newResource = @{
            ResourceAppId  = "00000003-0000-0000-c000-000000000000"
            ResourceAccess = @($newRole)
        }
        $currentAccess += $newResource
    }

    Update-MgApplication -ApplicationId $app.Id -RequiredResourceAccess $currentAccess
    Write-Host "      Permission added to app registration."

    $body = @{
        PrincipalId = $appSp.Id
        ResourceId  = $graphSp.Id
        AppRoleId   = $notesRole.Id
    }
    New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $appSp.Id -BodyParameter $body | Out-Null
    Write-Host "      Admin consent granted."
}

Write-Host ""
Write-Host "[5/5] Verifying..."
$assignments = Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $appSp.Id
$verified = $assignments | Where-Object { $_.AppRoleId -eq $notesRole.Id }

if ($verified) {
    Write-Host ""
    Write-Host "============================================"
    Write-Host " SUCCESS - Notes.ReadWrite.All is active   "
    Write-Host "============================================"
    Write-Host ""
    Write-Host " Next steps:"
    Write-Host "   1. Restart Claude desktop"
    Write-Host "   2. Ask Claude to create a Cisco phone install workflow"
    Write-Host "   3. Claude creates the OneNote page with checkboxes"
    Write-Host "   4. Share the OneNote link with your field tech"
    Write-Host ""
} else {
    Write-Host "WARNING: Could not verify. Check Azure Portal manually."
}

Disconnect-MgGraph | Out-Null
