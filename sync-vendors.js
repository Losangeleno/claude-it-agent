/**
 * sync-vendors.js — Daily Vendor Docs → SharePoint KB Sync
 * Vendors: Cisco, Dell, HP/HPE, Fujitsu
 *
 * Usage:
 *   node sync-vendors.js                    (run all vendors/topics)
 *   node sync-vendors.js cisco              (run only Cisco topics)
 *   node sync-vendors.js dell "poweredge"   (run Dell topics matching keyword)
 *   node sync-vendors.js --list             (list all configured topics)
 */

"use strict";

const https = require("https");

// ── Config ────────────────────────────────────────────────────────────────────
const TENANT_ID     = process.env.AZURE_TENANT_ID     || "e876d5db-a9f8-4e71-abc1-dcee4d8b0578";
const CLIENT_ID     = process.env.AZURE_CLIENT_ID     || "50d28fcf-1e66-452f-be81-36b40b640605";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || "OCy8Q~qnTAqtSfK.8bIdnKVqcCv46zMFGkIhQbtc";

const LIBRARY_DRIVES = {
  "troubleshooting": "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-s9M-vo64gR6RqcavYF4co",
  "runbooks":        "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d8ntgJz28NVQ5IBUqynE4Gk",
  "faqs":            "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-0YkaK7sToQb9UfBCD0V8l",
  "assets":          "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9OV5yeNjEWSZzs4VJ2fbAB",
  "cabling":         "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9lg9HgzNLwT7cu7swCUvqF"
};

// Vendor support site domains and search scoping
const VENDOR_SITES = {
  cisco:   { domain: "cisco.com",          pathScope: "/c/en/us/support" },
  dell:    { domain: "dell.com",            pathScope: "/support" },
  hp:      { domain: "support.hp.com",      pathScope: "/us-en" },
  hpe:     { domain: "support.hpe.com",     pathScope: "/hpesc" },
  fujitsu: { domain: "support.fujitsu.com", pathScope: "" },
  apple:   { domain: "support.apple.com",   pathScope: "" }
};

// ── Vendor Topic Taxonomy ─────────────────────────────────────────────────────
const VENDOR_TOPICS = [

  // ── CISCO ──────────────────────────────────────────────────────────────────
  // Switching
  { vendor: "cisco", topic: "Cisco Catalyst switch port not working troubleshooting",        library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco switch VLAN configuration setup guide",                   library: "runbooks",        articles: 2 },
  { vendor: "cisco", topic: "Cisco switch spanning tree STP troubleshooting loop",           library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco switch port security MAC address violation",              library: "troubleshooting", articles: 1 },
  { vendor: "cisco", topic: "Cisco PoE power over ethernet not working phone",              library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco switch firmware upgrade IOS update procedure",           library: "runbooks",        articles: 2 },
  { vendor: "cisco", topic: "Cisco show commands troubleshooting reference guide",           library: "runbooks",        articles: 2 },
  { vendor: "cisco", topic: "Cisco switch stack configuration setup",                        library: "runbooks",        articles: 1 },

  // Routing
  { vendor: "cisco", topic: "Cisco router interface not up down troubleshooting",            library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco OSPF routing not working convergence problem",            library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco BGP neighbor not establishing troubleshoot",              library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco router NAT configuration setup guide",                    library: "runbooks",        articles: 2 },
  { vendor: "cisco", topic: "Cisco ACL access control list configure block allow",           library: "runbooks",        articles: 2 },

  // VPN & Security
  { vendor: "cisco", topic: "Cisco AnyConnect VPN not connecting error fix",                library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco ASA firewall policy troubleshoot connectivity",           library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco Firepower NGFW rules configuration",                     library: "runbooks",        articles: 2 },
  { vendor: "cisco", topic: "Cisco AnyConnect VPN install configure client",                library: "runbooks",        articles: 2 },

  // Wireless
  { vendor: "cisco", topic: "Cisco Meraki wireless access point not connecting client",     library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco wireless controller WLC client association problem",     library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco access point reset factory default",                      library: "runbooks",        articles: 1 },

  // IP Telephony
  { vendor: "cisco", topic: "Cisco IP phone not registering CUCM troubleshoot",             library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco Unified Communications Manager CUCM user setup",         library: "runbooks",        articles: 2 },
  { vendor: "cisco", topic: "Cisco IP phone no dial tone call quality issue",               library: "troubleshooting", articles: 2 },
  { vendor: "cisco", topic: "Cisco phone reset factory default reboot procedure",           library: "runbooks",        articles: 1 },

  // ── DELL ───────────────────────────────────────────────────────────────────
  // Desktops/Laptops
  { vendor: "dell", topic: "Dell OptiPlex will not boot black screen fix",                  library: "troubleshooting", articles: 2 },
  { vendor: "dell", topic: "Dell OptiPlex slow performance troubleshooting",                library: "troubleshooting", articles: 2 },
  { vendor: "dell", topic: "Dell Latitude laptop battery not charging fix",                 library: "troubleshooting", articles: 2 },
  { vendor: "dell", topic: "Dell Latitude display flickering blank screen fix",             library: "troubleshooting", articles: 2 },
  { vendor: "dell", topic: "Dell Latitude Wi-Fi not connecting driver issue",               library: "troubleshooting", articles: 2 },
  { vendor: "dell", topic: "Dell laptop keyboard trackpad not working fix",                 library: "troubleshooting", articles: 1 },
  { vendor: "dell", topic: "Dell BIOS update firmware upgrade procedure",                   library: "runbooks",        articles: 2 },
  { vendor: "dell", topic: "Dell SupportAssist hardware diagnostic run",                    library: "runbooks",        articles: 2 },
  { vendor: "dell", topic: "Dell factory reset restore Windows reinstall",                  library: "runbooks",        articles: 2 },
  { vendor: "dell", topic: "Dell service tag warranty lookup support check",                library: "faqs",            articles: 1 },

  // Servers
  { vendor: "dell", topic: "Dell PowerEdge server will not POST beep code error",          library: "troubleshooting", articles: 2 },
  { vendor: "dell", topic: "Dell iDRAC remote access configuration setup",                  library: "runbooks",        articles: 2 },
  { vendor: "dell", topic: "Dell PowerEdge RAID controller PERC disk failure rebuild",      library: "troubleshooting", articles: 2 },
  { vendor: "dell", topic: "Dell PowerEdge firmware lifecycle controller update",           library: "runbooks",        articles: 2 },
  { vendor: "dell", topic: "Dell iDRAC alert email notification configure",                 library: "runbooks",        articles: 1 },
  { vendor: "dell", topic: "Dell PowerEdge server fan noise overheating thermal alert",     library: "troubleshooting", articles: 2 },
  { vendor: "dell", topic: "Dell server memory RAM failure diagnostic",                     library: "troubleshooting", articles: 1 },
  { vendor: "dell", topic: "Dell PowerEdge physical disk replace hot swap",                 library: "runbooks",        articles: 2 },

  // Monitors/Peripherals
  { vendor: "dell", topic: "Dell monitor no signal display not detected fix",               library: "troubleshooting", articles: 2 },
  { vendor: "dell", topic: "Dell dock WD19 USB-C not working display issue",                library: "troubleshooting", articles: 2 },

  // ── HP ─────────────────────────────────────────────────────────────────────
  // Laptops/Desktops
  { vendor: "hp", topic: "HP EliteBook laptop will not turn on power issue fix",            library: "troubleshooting", articles: 2 },
  { vendor: "hp", topic: "HP EliteBook display black screen backlight problem",             library: "troubleshooting", articles: 2 },
  { vendor: "hp", topic: "HP EliteBook battery not charging power adapter fix",             library: "troubleshooting", articles: 2 },
  { vendor: "hp", topic: "HP ProBook Wi-Fi Bluetooth driver not working fix",               library: "troubleshooting", articles: 2 },
  { vendor: "hp", topic: "HP EliteDesk desktop will not boot POST error",                   library: "troubleshooting", articles: 2 },
  { vendor: "hp", topic: "HP BIOS firmware update procedure Windows",                       library: "runbooks",        articles: 2 },
  { vendor: "hp", topic: "HP PC Hardware Diagnostics UEFI run memory disk test",            library: "runbooks",        articles: 2 },
  { vendor: "hp", topic: "HP Sure Start BIOS protection recovery procedure",                library: "runbooks",        articles: 1 },
  { vendor: "hp", topic: "HP factory reset restore system recovery",                        library: "runbooks",        articles: 2 },
  { vendor: "hp", topic: "HP warranty check serial number service support",                 library: "faqs",            articles: 1 },

  // Printers
  { vendor: "hp", topic: "HP LaserJet printer offline not printing fix Windows 11",         library: "troubleshooting", articles: 2 },
  { vendor: "hp", topic: "HP LaserJet paper jam clear procedure",                           library: "troubleshooting", articles: 2 },
  { vendor: "hp", topic: "HP printer cartridge toner not recognized replace",               library: "troubleshooting", articles: 1 },
  { vendor: "hp", topic: "HP LaserJet network printer IP address setup configure",          library: "runbooks",        articles: 2 },
  { vendor: "hp", topic: "HP LaserJet print quality poor faded streaks fix",               library: "troubleshooting", articles: 2 },
  { vendor: "hp", topic: "HP printer driver install uninstall Windows 11",                  library: "runbooks",        articles: 2 },
  { vendor: "hp", topic: "HP Smart app printer setup wireless connection",                  library: "runbooks",        articles: 1 },

  // HPE Servers
  { vendor: "hpe", topic: "HPE ProLiant server POST failure diagnostic iLO",               library: "troubleshooting", articles: 2 },
  { vendor: "hpe", topic: "HPE iLO 5 remote access setup configuration",                    library: "runbooks",        articles: 2 },
  { vendor: "hpe", topic: "HPE Smart Array controller disk failure rebuild RAID",            library: "troubleshooting", articles: 2 },
  { vendor: "hpe", topic: "HPE server firmware update SPP Service Pack ProLiant",           library: "runbooks",        articles: 2 },
  { vendor: "hpe", topic: "HPE ProLiant server fan error thermal shutdown",                 library: "troubleshooting", articles: 2 },
  { vendor: "hpe", topic: "HPE server memory DIMM failure uncorrectable error",             library: "troubleshooting", articles: 2 },
  { vendor: "hpe", topic: "HPE iLO alert SNMP email notification configure",               library: "runbooks",        articles: 1 },

  // ── FUJITSU ────────────────────────────────────────────────────────────────
  // Laptops
  { vendor: "fujitsu", topic: "Fujitsu LIFEBOOK laptop will not start power issue",         library: "troubleshooting", articles: 2 },
  { vendor: "fujitsu", topic: "Fujitsu LIFEBOOK display screen problem fix",                library: "troubleshooting", articles: 2 },
  { vendor: "fujitsu", topic: "Fujitsu LIFEBOOK battery not charging fix",                  library: "troubleshooting", articles: 1 },
  { vendor: "fujitsu", topic: "Fujitsu LIFEBOOK BIOS update firmware upgrade",              library: "runbooks",        articles: 2 },
  { vendor: "fujitsu", topic: "Fujitsu LIFEBOOK recovery factory reset restore",            library: "runbooks",        articles: 2 },
  { vendor: "fujitsu", topic: "Fujitsu LIFEBOOK driver download Windows 11 support",       library: "runbooks",        articles: 2 },

  // Servers
  { vendor: "fujitsu", topic: "Fujitsu PRIMERGY server POST error diagnostic",              library: "troubleshooting", articles: 2 },
  { vendor: "fujitsu", topic: "Fujitsu iRMC remote management setup configuration",         library: "runbooks",        articles: 2 },
  { vendor: "fujitsu", topic: "Fujitsu PRIMERGY RAID controller ServerView setup",          library: "runbooks",        articles: 2 },
  { vendor: "fujitsu", topic: "Fujitsu server firmware update ServerView procedure",        library: "runbooks",        articles: 2 },

  // Scanners
  { vendor: "fujitsu", topic: "Fujitsu fi series scanner not recognized driver fix",        library: "troubleshooting", articles: 2 },
  { vendor: "fujitsu", topic: "Fujitsu scanner paper jam clear double feed fix",            library: "troubleshooting", articles: 2 },
  { vendor: "fujitsu", topic: "Fujitsu ScanSnap setup configure Windows 11",               library: "runbooks",        articles: 2 },
  { vendor: "fujitsu", topic: "Fujitsu scanner image quality poor calibration fix",         library: "troubleshooting", articles: 1 },

  // Printers
  { vendor: "fujitsu", topic: "Fujitsu printer not printing driver issue Windows",          library: "troubleshooting", articles: 2 },
  { vendor: "fujitsu", topic: "Fujitsu printer network setup IP configure",                 library: "runbooks",        articles: 1 },

  // ── APPLE ──────────────────────────────────────────────────────────────────

  // Apple Business Manager & MDM Infrastructure
  { vendor: "apple", topic: "Apple Business Manager setup enroll organization account",              library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Apple Business Manager link Microsoft Intune MDM server token",         library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Apple Automated Device Enrollment ADE DEP configure Intune",            library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Apple Volume Purchase Program VPP apps licenses Intune deploy",         library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Apple Business Manager managed Apple ID setup federated authentication",library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Apple Configurator 2 supervise iPhone iPad bulk enroll",                library: "runbooks",        articles: 2 },

  // iPhone Enterprise Enrollment & Configuration
  { vendor: "apple", topic: "iPhone enroll corporate Intune MDM step by step ADE supervised",       library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "iPhone BYOD enrollment Intune Company Portal personal device",          library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "iPhone corporate Wi-Fi 802.1x certificate EAP Intune profile",          library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "iPhone corporate VPN Cisco AnyConnect configure Intune",                library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "iPhone Exchange email Outlook configure corporate account",              library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Microsoft Authenticator MFA setup iPhone corporate",                    library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "iPhone deploy push apps Intune managed device app policy",              library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "iPhone app protection policy MAM Intune data loss prevention",          library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "iPhone Conditional Access Entra ID compliant device policy",            library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "iPhone remote wipe retire Intune lost stolen device",                   library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "iPhone compliance policy Intune passcode encryption requirements",       library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "iPhone update iOS Intune software update policy managed",               library: "runbooks",        articles: 1 },
  { vendor: "apple", topic: "iPhone factory reset erase all content supervised corporate",            library: "runbooks",        articles: 1 },

  // iPhone Troubleshooting
  { vendor: "apple", topic: "iPhone not receiving corporate email Outlook Exchange fix",              library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "iPhone not connecting corporate Wi-Fi certificate error fix",            library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "iPhone MDM enrollment failed error troubleshoot Intune",                library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "iPhone VPN not connecting corporate network AnyConnect fix",             library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "iPhone Microsoft Teams not working audio video fix",                     library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "iPhone battery draining fast background app corporate fix",              library: "troubleshooting", articles: 1 },
  { vendor: "apple", topic: "iPhone screen cracked replacement repair corporate policy",              library: "faqs",            articles: 1 },
  { vendor: "apple", topic: "iPhone app not installing managed device Intune error",                  library: "troubleshooting", articles: 2 },

  // iPad Enterprise
  { vendor: "apple", topic: "iPad shared device mode Intune kiosk single app corporate",             library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "iPad conference room display AirPlay enterprise setup",                  library: "runbooks",        articles: 1 },
  { vendor: "apple", topic: "iPad cellular data plan corporate MDM configure",                        library: "runbooks",        articles: 1 },

  // Mac Enterprise Enrollment & Management
  { vendor: "apple", topic: "Mac enroll Microsoft Intune Company Portal macOS step by step",         library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac ADE automated enrollment Intune Apple Business Manager",             library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac Intune compliance policy configure FileVault Gatekeeper",            library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac Intune configuration profile deploy settings Wi-Fi VPN",             library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac software update policy Intune managed macOS version enforce",        library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac app deploy Intune pkg dmg managed software install",                 library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac FileVault disk encryption enable Intune escrow recovery key",        library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac Microsoft Defender for Endpoint install configure macOS",            library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac Entra ID Azure AD join register device",                             library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac Active Directory bind domain join configure",                        library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac corporate Wi-Fi 802.1x certificate profile Intune",                 library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac Cisco AnyConnect VPN install configure corporate",                   library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac remote wipe retire Intune lost stolen",                              library: "runbooks",        articles: 1 },
  { vendor: "apple", topic: "Mac Conditional Access Intune compliant device policy",                  library: "runbooks",        articles: 2 },

  // Microsoft 365 on Mac
  { vendor: "apple", topic: "Microsoft 365 Office install Mac step by step activate license",         library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Outlook Mac setup Exchange account corporate email configure",            library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Outlook Mac not syncing email calendar contacts Exchange fix",            library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "Microsoft Teams Mac install setup corporate account",                     library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Microsoft Teams Mac audio microphone camera not working fix",             library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "OneDrive Mac setup sync corporate SharePoint files",                      library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "OneDrive Mac sync error not working fix",                                 library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "Microsoft Edge Mac install configure enterprise policy",                   library: "runbooks",        articles: 1 },

  // macOS Troubleshooting
  { vendor: "apple", topic: "MacBook Pro Air will not turn on black screen power issue fix",           library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "Mac running slow spinning beach ball performance fix",                    library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "macOS Wi-Fi not connecting dropping network issues fix",                  library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "Mac external monitor display not detected HDMI DisplayPort fix",          library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "MacBook battery not charging power adapter MagSafe fix",                  library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "Mac keyboard trackpad not responding fix",                                library: "troubleshooting", articles: 1 },
  { vendor: "apple", topic: "Mac Bluetooth not working pairing issue fix",                             library: "troubleshooting", articles: 1 },
  { vendor: "apple", topic: "Mac printer not working add remove driver fix",                           library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "Mac application crashing not opening force quit fix",                     library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "macOS update stuck failed not installing fix",                            library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "Mac startup slow boot issues login problems fix",                         library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "Mac kernel panic crash restart loop fix",                                 library: "troubleshooting", articles: 2 },
  { vendor: "apple", topic: "Mac disk full storage cleanup management",                                library: "troubleshooting", articles: 1 },
  { vendor: "apple", topic: "Mac microphone camera not working permissions fix",                       library: "troubleshooting", articles: 1 },

  // macOS Runbooks
  { vendor: "apple", topic: "macOS clean install erase reinstall Recovery Mode step by step",          library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac Disk Utility first aid verify repair APFS HFS",                      library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac safe mode verbose mode recovery troubleshooting boot options",        library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac SMC NVRAM PRAM reset procedure MacBook desktop",                      library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac Activity Monitor diagnose CPU memory disk network usage",             library: "runbooks",        articles: 1 },
  { vendor: "apple", topic: "Mac Console app system log diagnostic troubleshoot",                      library: "runbooks",        articles: 1 },
  { vendor: "apple", topic: "Time Machine backup setup restore corporate data",                        library: "runbooks",        articles: 2 },
  { vendor: "apple", topic: "Mac Migration Assistant transfer data new Mac corporate",                 library: "runbooks",        articles: 1 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
let spToken = null, spExpiry = 0;

function httpreq(o, b) {
  return new Promise(function(res, rej) {
    var r = https.request(o, function(re) {
      var d = ""; re.on("data", function(c) { d += c; });
      re.on("end", function() {
        try { res({ status: re.statusCode, body: JSON.parse(d) }); }
        catch(e) { res({ status: re.statusCode, body: d }); }
      });
    });
    r.on("error", rej); if (b) r.write(b); r.end();
  });
}

function getToken() {
  if (spToken && Date.now() < spExpiry) return Promise.resolve(spToken);
  var b = "grant_type=client_credentials&client_id=" + encodeURIComponent(CLIENT_ID)
        + "&client_secret=" + encodeURIComponent(CLIENT_SECRET)
        + "&scope=" + encodeURIComponent("https://graph.microsoft.com/.default");
  return httpreq({
    hostname: "login.microsoftonline.com",
    path: "/" + TENANT_ID + "/oauth2/v2.0/token",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(b) }
  }, b).then(function(r) {
    spToken = r.body.access_token;
    spExpiry = Date.now() + (r.body.expires_in - 60) * 1000;
    return spToken;
  });
}

function fetchPageText(urlString, maxLen) {
  maxLen = maxLen || 5000;
  return new Promise(function(resolve) {
    try {
      var u = new URL(urlString);
      if (u.protocol !== "https:") { resolve(""); return; }
      var r = https.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html,application/xhtml+xml" }
      }, function(res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(fetchPageText(res.headers.location, maxLen)); return;
        }
        var data = "";
        res.on("data", function(c) { data += c; if (data.length > 300000) res.destroy(); });
        res.on("end", function() {
          var text = data
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[\s\S]*?<\/nav>/gi, "")
            .replace(/<header[\s\S]*?<\/header>/gi, "")
            .replace(/<footer[\s\S]*?<\/footer>/gi, "")
            .replace(/<aside[\s\S]*?<\/aside>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/\s{3,}/g, "\n\n")
            .trim();
          resolve(text.substring(0, maxLen));
        });
      });
      r.on("error", function() { resolve(""); });
      r.setTimeout(15000, function() { r.destroy(); resolve(""); });
    } catch(e) { resolve(""); }
  });
}

function searchVendorArticles(vendor, query, maxResults) {
  var site = VENDOR_SITES[vendor];
  if (!site) return Promise.resolve([]);
  var ddgQuery = "site:" + site.domain + site.pathScope + " " + query;
  return new Promise(function(resolve) {
    var path = "/html/?q=" + encodeURIComponent(ddgQuery);
    var r = https.get({
      hostname: "html.duckduckgo.com",
      path: path,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" }
    }, function(res) {
      var data = "";
      res.on("data", function(c) { data += c; });
      res.on("end", function() {
        var matches = [];
        // Parse DDG result links
        var rx = /href="(\/l\/\?uddg=[^"]+|https?:\/\/[^"]+)"/g;
        var m;
        while ((m = rx.exec(data)) !== null && matches.length < maxResults * 2) {
          var href = m[1];
          var actual = href;
          // Decode DDG redirect URLs
          if (href.startsWith("/l/?")) {
            try {
              var u = new URL("https://duckduckgo.com" + href);
              actual = decodeURIComponent(u.searchParams.get("uddg") || u.searchParams.get("u") || "");
            } catch(e) { continue; }
          }
          if (actual && actual.startsWith("https") && actual.includes(site.domain) && !actual.includes("duckduckgo")) {
            // Extract title from nearby text
            var titleRx = new RegExp('<a[^>]*href="' + href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>([^<]+)<', '');
            var titleMatch = data.match(titleRx);
            var title = titleMatch ? titleMatch[1].trim() : vendor.toUpperCase() + " support article";
            if (!matches.find(function(x) { return x.url === actual; })) {
              matches.push({ url: actual, title: title });
            }
          }
        }
        resolve(matches.slice(0, maxResults));
      });
    });
    r.on("error", function() { resolve([]); });
    r.setTimeout(12000, function() { r.destroy(); resolve([]); });
  });
}

function uploadToKB(driveId, filename, content) {
  var fileData = Buffer.from(content, "utf8");
  return getToken().then(function(t) {
    return new Promise(function(resolve, reject) {
      var r = https.request({
        hostname: "graph.microsoft.com",
        path: "/v1.0/drives/" + driveId + "/root:/" + encodeURIComponent(filename) + ":/content",
        method: "PUT",
        headers: { Authorization: "Bearer " + t, "Content-Type": "text/plain; charset=utf-8", "Content-Length": fileData.length }
      }, function(re) {
        var d = ""; re.on("data", function(c) { d += c; });
        re.on("end", function() { resolve(re.statusCode); });
      });
      r.on("error", reject); r.write(fileData); r.end();
    });
  });
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ── Main sync function ────────────────────────────────────────────────────────
async function syncVendorTopic(entry) {
  var { vendor, topic, library, articles } = entry;
  var driveId = LIBRARY_DRIVES[library.toLowerCase()] || LIBRARY_DRIVES["troubleshooting"];

  var results = await searchVendorArticles(vendor, topic, articles);
  if (!results.length) {
    console.log("  ⚠ No results found for: " + topic);
    return { ok: 0, skip: 1 };
  }

  var ok = 0, skip = 0;
  for (var item of results) {
    try {
      var content = await fetchPageText(item.url, 6000);
      if (!content || content.length < 100) { skip++; continue; }
      var slug = (item.title || topic).replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-").toLowerCase().substring(0, 55);
      var filename = vendor.toLowerCase() + "-" + slug + ".md";
      var markdown = "# " + (item.title || topic) + "\n\n"
        + "> **Vendor:** " + vendor.toUpperCase() + "\n"
        + "> **Source:** " + item.url + "\n"
        + "> **Library:** " + library + "\n"
        + "> **Synced:** " + new Date().toISOString().split("T")[0] + "\n\n"
        + content.replace(/\s{3,}/g, "\n\n").trim();
      var status = await uploadToKB(driveId, filename, markdown);
      if (status === 200 || status === 201) {
        console.log("  ✓ " + filename);
        ok++;
      } else {
        console.log("  ✗ Upload failed (HTTP " + status + "): " + filename);
        skip++;
      }
    } catch(e) {
      console.log("  ✗ Error: " + e.message);
      skip++;
    }
    await sleep(2000); // Polite delay between fetches
  }
  return { ok, skip };
}

async function main() {
  var args = process.argv.slice(2);

  if (args.includes("--list")) {
    var vendors = [...new Set(VENDOR_TOPICS.map(function(t) { return t.vendor; }))];
    console.log("Configured vendor sync topics (" + VENDOR_TOPICS.length + " total):\n");
    vendors.forEach(function(v) {
      var topics = VENDOR_TOPICS.filter(function(t) { return t.vendor === v; });
      console.log("── " + v.toUpperCase() + " (" + topics.length + " topics) ──");
      topics.forEach(function(t, i) {
        console.log("  " + (i + 1) + ". [" + t.library + "] " + t.topic + " (" + t.articles + " articles)");
      });
      console.log("");
    });
    return;
  }

  var vendorFilter = args[0] && !args[0].startsWith("--") ? args[0].toLowerCase() : null;
  var topicFilter  = args[1] ? args[1].toLowerCase() : null;

  var topicsToRun = VENDOR_TOPICS;
  if (vendorFilter) topicsToRun = topicsToRun.filter(function(t) { return t.vendor === vendorFilter; });
  if (topicFilter)  topicsToRun = topicsToRun.filter(function(t) { return t.topic.toLowerCase().includes(topicFilter); });

  if (!topicsToRun.length) {
    console.log("No matching topics. Use --list to see all configured topics.");
    return;
  }

  console.log("=== Claude IT Agent — Vendor Docs KB Sync ===");
  console.log("Date:   " + new Date().toISOString());
  console.log("Topics: " + topicsToRun.length);
  if (vendorFilter) console.log("Vendor: " + vendorFilter.toUpperCase());
  console.log("");

  var stats = { cisco: { ok: 0, skip: 0 }, dell: { ok: 0, skip: 0 }, hp: { ok: 0, skip: 0 }, hpe: { ok: 0, skip: 0 }, fujitsu: { ok: 0, skip: 0 } };
  var totalOk = 0, totalSkip = 0;

  for (var entry of topicsToRun) {
    console.log("→ [" + entry.vendor.toUpperCase() + "][" + entry.library + "] " + entry.topic);
    try {
      var result = await syncVendorTopic(entry);
      totalOk   += result.ok;
      totalSkip += result.skip;
      if (stats[entry.vendor]) { stats[entry.vendor].ok += result.ok; stats[entry.vendor].skip += result.skip; }
    } catch(e) {
      console.log("  ✗ Failed: " + e.message);
      totalSkip++;
    }
    await sleep(3000); // Pause between topics
  }

  console.log("\n=== Vendor Sync Complete ===");
  console.log("Vendor breakdown:");
  Object.entries(stats).forEach(function(e) {
    if (e[1].ok + e[1].skip > 0) {
      console.log("  " + e[0].toUpperCase().padEnd(8) + " ✓ " + e[1].ok + " uploaded, ⚠ " + e[1].skip + " skipped");
    }
  });
  console.log("\nTotal: ✓ " + totalOk + " uploaded, ⚠ " + totalSkip + " skipped");
  console.log("Time:  " + new Date().toISOString());
}

main().catch(function(e) { console.error("Fatal:", e); process.exit(1); });
