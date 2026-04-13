# create-teams-webhook.ps1
# Creates an Incoming Webhook connector on a Teams channel
# and prints the webhook URL to paste into .env
#
# Run with:  powershell -ExecutionPolicy Bypass -File create-teams-webhook.ps1

$tenantId     = "e876d5db-a9f8-4e71-abc1-dcee4d8b0578"
$clientId     = "9c823e8e-5ce1-480c-8240-e19f6b23512e"
$clientSecret = "pMN8Q~7qNKr6pjEc4j9FLTHBA74rH.CwjwnjmbAg"

# ── Get token ────────────────────────────────────────────────────────────────
Write-Host "`nGetting access token..." -ForegroundColor Cyan
$tokenResponse = Invoke-RestMethod `
  -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" `
  -Method POST `
  -Body @{
    grant_type    = "client_credentials"
    client_id     = $clientId
    client_secret = $clientSecret
    scope         = "https://graph.microsoft.com/.default"
  }
$token = $tokenResponse.access_token
Write-Host "Token acquired." -ForegroundColor Green

# ── List Teams ───────────────────────────────────────────────────────────────
Write-Host "`nFetching Teams..." -ForegroundColor Cyan
$teams = Invoke-RestMethod `
  -Uri "https://graph.microsoft.com/v1.0/groups?`$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&`$select=id,displayName" `
  -Headers @{ Authorization = "Bearer $token" }

Write-Host "`nAvailable Teams:"
$i = 0
foreach ($t in $teams.value) {
  Write-Host "  [$i] $($t.displayName)  ($($t.id))"
  $i++
}
$teamIndex = Read-Host "`nEnter the number of the team to add the webhook to"
$selectedTeam = $teams.value[$teamIndex]
Write-Host "Selected: $($selectedTeam.displayName)" -ForegroundColor Green

# ── List Channels ─────────────────────────────────────────────────────────────
Write-Host "`nFetching channels..." -ForegroundColor Cyan
$channels = Invoke-RestMethod `
  -Uri "https://graph.microsoft.com/v1.0/teams/$($selectedTeam.id)/channels?`$select=id,displayName" `
  -Headers @{ Authorization = "Bearer $token" }

Write-Host "`nAvailable Channels:"
$j = 0
foreach ($c in $channels.value) {
  Write-Host "  [$j] $($c.displayName)  ($($c.id))"
  $j++
}
$channelIndex = Read-Host "`nEnter the number of the channel to add the webhook to"
$selectedChannel = $channels.value[$channelIndex]
Write-Host "Selected: $($selectedChannel.displayName)" -ForegroundColor Green

# ── Create Incoming Webhook ───────────────────────────────────────────────────
Write-Host "`nCreating Incoming Webhook..." -ForegroundColor Cyan
$webhookBody = @{
  "@odata.type"    = "#microsoft.graph.incomingWebhook"
  displayName      = "IT Agent"
  configuration    = @{
    "@odata.type" = "#microsoft.graph.webhookConfiguration"
  }
} | ConvertTo-Json -Depth 5

try {
  $webhook = Invoke-RestMethod `
    -Uri "https://graph.microsoft.com/v1.0/teams/$($selectedTeam.id)/channels/$($selectedChannel.id)/tabs" `
    -Method POST `
    -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
    -Body $webhookBody
  Write-Host "Webhook created!" -ForegroundColor Green
  Write-Host "`n✅ Webhook URL:`n$($webhook.webhookUrl)" -ForegroundColor Yellow
  Write-Host "`nCopy the URL above and paste it into C:\claude-it-agent\.env as:"
  Write-Host "TEAMS_ALERTS_WEBHOOK=<paste url here>" -ForegroundColor Cyan
} catch {
  # Graph API may block programmatic webhook creation on some tenants.
  # Fall back to manual instructions.
  Write-Host "`n⚠️  Programmatic webhook creation is restricted on this tenant." -ForegroundColor Yellow
  Write-Host "Do this instead (30 seconds in Teams):" -ForegroundColor White
  Write-Host ""
  Write-Host "  1. Open Teams → go to the '$($selectedChannel.displayName)' channel in '$($selectedTeam.displayName)'"
  Write-Host "  2. Click '...' next to the channel name → Connectors (or Manage channel → Connectors)"
  Write-Host "  3. Find 'Incoming Webhook' → Configure"
  Write-Host "  4. Name it 'IT Agent' → Create"
  Write-Host "  5. Copy the URL and paste into C:\claude-it-agent\.env as:"
  Write-Host "     TEAMS_ALERTS_WEBHOOK=<paste url here>" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Team ID (you'll need this for other tools):" -ForegroundColor Gray
  Write-Host "  $($selectedTeam.id)"
  Write-Host "Channel ID:" -ForegroundColor Gray
  Write-Host "  $($selectedChannel.id)"
}
