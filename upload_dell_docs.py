import urllib.request, urllib.parse, json, ssl

TENANT_ID     = "e876d5db-a9f8-4e71-abc1-dcee4d8b0578"
CLIENT_ID     = "50d28fcf-1e66-452f-be81-36b40b640605"
CLIENT_SECRET = "OCy8Q~qnTAqtSfK.8bIdnKVqcCv46zMFGkIhQbtc"

DRIVES = {
    "FAQs":            "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-0YkaK7sToQb9UfBCD0V8l",
    "Troubleshooting": "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-s9M-vo64gR6RqcavYF4co",
    "Runbooks":        "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d8ntgJz28NVQ5IBUqynE4Gk",
}

DOCS = {
    "FAQs": ("dell-support-resources.md", """# Dell Support Resources (Free, No Account Required)

## Primary Support Portal
support.dell.com — Enter any Service Tag or model to access manuals, drivers, BIOS updates, diagnostics, and warranty status. No login required.

## How to Look Up a Device
1. Go to https://support.dell.com
2. Enter the Service Tag (7-character code on device label) or Model Number
3. Browse manuals, drivers, or run diagnostics

## Getting a Service Tag
- Physical label: Bottom/back of laptop, rear of desktop, front bezel of server
- Command Prompt: wmic bios get serialnumber
- PowerShell: Get-WmiObject Win32_BIOS | Select-Object SerialNumber
- BIOS screen: Press F2 on boot > System Information

## Key URLs
- Manuals: https://www.dell.com/support/manuals/
- Drivers: https://www.dell.com/support/home/
- Error code lookup: https://support.dell.com/en-us/diagnostic-error-codes

## FAQs

Q: I have a model number but no Service Tag - can I still get docs?
A: Yes. Search by model name at support.dell.com for generic model docs and drivers.

Q: Are drivers free to download?
A: Yes. All Dell drivers are free at support.dell.com. No account or warranty required.

Q: How do I check warranty status?
A: Enter Service Tag at support.dell.com - warranty expiration shown at top of page.

Q: What if the Service Tag sticker is worn off?
A: Run: wmic bios get serialnumber  Or check BIOS (F2 on boot) > System Information.
"""),

    "Troubleshooting": ("dell-hardware-troubleshooting.md", """# Dell Hardware Troubleshooting Guide

## Built-In Diagnostics (ePSA / SupportAssist)
1. Power off the device
2. Power on and press F12 repeatedly
3. Select Diagnostics from boot menu
4. Note any error codes (format: XXXX:YYYY)
5. Look up at: https://support.dell.com/en-us/diagnostic-error-codes

## LED Diagnostic Codes (OptiPlex / Latitude Desktops)
Amber 2 + White 3 = No RAM detected
Amber 2 + White 4 = RAM failure
Amber 2 + White 6 = GPU/video failure
Amber 3 + White 1 = CMOS battery / RTC failure
Amber 3 + White 3 = BIOS recovery needed

## Common Issues and Fixes

No Power:
Hold power button 30 sec. Remove battery + AC, hold power 15 sec, reconnect AC only and test.

No Display / Black Screen:
Try external monitor. Reseat RAM sticks. Run ePSA (F12 > Diagnostics). Check for beep codes.

Overheating / Fan Running Constantly:
Clean vents with compressed air. Replace thermal paste if 3+ years old. Update BIOS from support.dell.com.

Slow Performance:
Run SupportAssist full scan. Check drive health: wmic diskdrive get status
Clean vents. Consider RAM upgrade if under 8GB.

WiFi Not Working:
Update network driver from support.dell.com by Service Tag.
Reset adapter: netsh wlan delete profile name="NetworkName" then reconnect.

Blue Screen (BSOD):
Note the STOP code. Run ePSA memory test (F12 > Diagnostics).
Update all drivers from support.dell.com. Run: sfc /scannow in elevated Command Prompt.

## BIOS Update
1. support.dell.com > enter Service Tag > Drivers & Downloads > BIOS
2. Download .exe and run in Windows (reboots automatically)
3. Never power off during BIOS update

## Finding Replacement Parts
1. support.dell.com > enter Service Tag > Parts & Accessories
2. Or check Service Manual for FRU part numbers
3. Order from parts.dell.com or cross-reference on Amazon
"""),

    "Runbooks": ("dell-device-lookup-runbook.md", """# Dell Device Lookup Runbook

## Purpose
Field procedure for identifying a Dell device and accessing its documentation, drivers, and support history on-site.

## Step 1: Get the Service Tag
Option A - Physical Label: Bottom/back of laptop, rear/side of desktop, front bezel of server
Option B - Command Prompt: wmic bios get serialnumber
Option C - PowerShell: Get-WmiObject Win32_BIOS | Select-Object SerialNumber
Option D - BIOS Screen: Power on, press F2, navigate to System Information

## Step 2: Pull Device Info from Dell
1. Go to https://support.dell.com
2. Enter Service Tag in the search box
3. View: device model, warranty status, expiration date, purchase date

## Step 3: Get Service Manual
1. On device support page > Documentation > Service Manual
2. Contains: disassembly steps with photos, FRU part numbers, RAM/storage upgrade paths, motherboard layout

## Step 4: Download Drivers
1. support.dell.com > Service Tag > Drivers & Downloads
2. Recommended install order:
   - BIOS first
   - Chipset
   - Storage Controller
   - Network (LAN + WiFi)
   - Audio / Video / everything else

## Step 5: Run Diagnostics
Pre-boot (no OS needed): Power on > press F12 > select Diagnostics
In Windows: Open Dell SupportAssist > Run All

## Quick Reference Commands
Get Service Tag:    wmic bios get serialnumber
Get model name:     wmic computersystem get model
Get RAM installed:  wmic memorychip get capacity
Get storage info:   wmic diskdrive get model,size
Get BIOS version:   wmic bios get smbiosbiosversion
Check OS build:     winver

## Escalation Path
Tier 1: This runbook + service manual from support.dell.com
Tier 2: Dell ProSupport (if under warranty): 1-800-945-3355
Tier 3: Parts order at parts.dell.com using FRU numbers from service manual
"""),
}

ctx = ssl.create_default_context()

print("Getting access token...")
body = urllib.parse.urlencode({
    "grant_type": "client_credentials",
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "scope": "https://graph.microsoft.com/.default"
}).encode()
req = urllib.request.Request(
    f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
    data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}
)
with urllib.request.urlopen(req, context=ctx) as r:
    token = json.loads(r.read())["access_token"]
print("Token acquired.\n")

headers = {"Authorization": "Bearer " + token, "Content-Type": "text/plain; charset=utf-8"}

for library, (filename, content) in DOCS.items():
    drive_id = DRIVES[library]
    data = content.encode("utf-8")
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{filename}:/content"
    req2 = urllib.request.Request(url, data=data, method="PUT", headers=headers)
    with urllib.request.urlopen(req2, context=ctx) as r:
        result = json.loads(r.read())
        print(f"Uploaded: {result['name']}  ->  {library}")

print("\nAll done! Dell docs are now live in your IT Knowledge Base.")
