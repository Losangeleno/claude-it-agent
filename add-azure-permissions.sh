#!/bin/bash
# add-azure-permissions.sh
# Adds the required Microsoft Graph API permissions to your IT Agent app
# and grants admin consent automatically.
#
# Requirements: Azure CLI (az)
# Install: https://aka.ms/installazurecli  or  winget install Microsoft.AzureCLI
#
# Run with:
#   bash "C:\claude-it-agent\add-azure-permissions.sh"
#   (works in Git Bash, WSL, or Azure Cloud Shell)

APP_ID="9c823e8e-5ce1-480c-8240-e19f6b23512e"
GRAPH_API="00000003-0000-0000-c000-000000000000"   # Microsoft Graph

PERMISSIONS=(
  "User.Read.All"
  "Group.Read.All"
  "Device.Read.All"
  "AuditLog.Read.All"
  "Team.ReadBasic.All"
  "ChannelMessage.Read.All"
)

# ── Preflight check ───────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo " IT Agent — Azure Permission Setup"
echo "========================================"
echo ""

if ! command -v az &>/dev/null; then
  echo "❌  Azure CLI not found."
  echo ""
  echo "Install it first, then re-run this script:"
  echo "  winget install Microsoft.AzureCLI"
  echo "  (or visit https://aka.ms/installazurecli)"
  exit 1
fi

echo "✅  Azure CLI found."

# ── Login ─────────────────────────────────────────────────────────────────────
echo ""
echo "Checking Azure login..."
ACCOUNT=$(az account show --query user.name -o tsv 2>/dev/null)

if [ -z "$ACCOUNT" ]; then
  echo "Not logged in — opening browser for sign-in..."
  az login --only-show-errors
else
  echo "✅  Logged in as: $ACCOUNT"
fi

# ── Look up permission GUIDs dynamically from Graph service principal ─────────
echo ""
echo "Looking up Microsoft Graph permission IDs..."
GRAPH_SP_APPID="00000003-0000-0000-c000-000000000000"

GRAPH_SP_OID=$(az ad sp show --id $GRAPH_SP_APPID --query id -o tsv 2>/dev/null)
if [ -z "$GRAPH_SP_OID" ]; then
  echo "❌  Could not find Microsoft Graph service principal. Check your login."
  exit 1
fi

# ── Add each permission ───────────────────────────────────────────────────────
echo ""
echo "Adding permissions to app: $APP_ID"
echo ""

for PERM in "${PERMISSIONS[@]}"; do
  echo -n "  Adding $PERM ... "

  # Look up the permission GUID by name
  PERM_ID=$(az ad sp show --id $GRAPH_SP_APPID \
    --query "appRoles[?value=='$PERM'].id" \
    -o tsv 2>/dev/null)

  if [ -z "$PERM_ID" ]; then
    echo "⚠️  Permission ID not found — skipping"
    continue
  fi

  # Add permission to the app registration
  az ad app permission add \
    --id "$APP_ID" \
    --api "$GRAPH_API" \
    --api-permissions "$PERM_ID=Role" \
    --only-show-errors 2>/dev/null

  echo "✅  Done (id: $PERM_ID)"
done

# ── Grant admin consent ───────────────────────────────────────────────────────
echo ""
echo "Granting admin consent..."
az ad app permission admin-consent --id "$APP_ID" --only-show-errors

if [ $? -eq 0 ]; then
  echo "✅  Admin consent granted."
else
  echo ""
  echo "⚠️  Admin consent failed."
  echo "    This usually means your account is not a Global Admin or"
  echo "    Privileged Role Admin. Ask your Azure admin to run:"
  echo ""
  echo "    az ad app permission admin-consent --id $APP_ID"
  echo ""
  echo "    Or grant it manually:"
  echo "    portal.azure.com → App registrations → $APP_ID"
  echo "    → API permissions → Grant admin consent"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo " Done. Permissions added:"
echo "========================================"
az ad app permission list \
  --id "$APP_ID" \
  --query "[].resourceAccess[].id" \
  -o tsv 2>/dev/null
echo ""
echo "Next step: restart Claude to pick up the new tools."
echo ""
