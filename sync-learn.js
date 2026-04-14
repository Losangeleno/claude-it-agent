/**
 * sync-learn.js — Daily Microsoft Learn → SharePoint KB Sync
 *
 * Runs on a schedule (via Cowork scheduled task or Azure cron job).
 * Searches Microsoft Learn for each topic in SYNC_TOPICS and uploads
 * the top articles to the appropriate SharePoint KB library.
 *
 * Usage:
 *   node sync-learn.js                  (run all topics)
 *   node sync-learn.js "Event Viewer"   (run one topic)
 *   node sync-learn.js --list           (list all topics)
 */

"use strict";

const https  = require("https");
const crypto = require("crypto");

// ── Config (matches app.js) ───────────────────────────────────────────────────
const TENANT_ID     = process.env.AZURE_TENANT_ID    || "e876d5db-a9f8-4e71-abc1-dcee4d8b0578";
const CLIENT_ID     = process.env.AZURE_CLIENT_ID    || "50d28fcf-1e66-452f-be81-36b40b640605";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET|| "OCy8Q~qnTAqtSfK.8bIdnKVqcCv46zMFGkIhQbtc";
const TENANT_NAME   = "ClaudeITAgent";
const SITE_NAME     = "ITKnowledgeBase";

const LIBRARY_DRIVES = {
  "troubleshooting": "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-s9M-vo64gR6RqcavYF4co",
  "runbooks":        "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d8ntgJz28NVQ5IBUqynE4Gk",
  "faqs":            "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-0YkaK7sToQb9UfBCD0V8l",
  "assets":          "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9OV5yeNjEWSZzs4VJ2fbAB",
  "cabling":         "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9lg9HgzNLwT7cu7swCUvqF"
};

// ── IT Topic Taxonomy ─────────────────────────────────────────────────────────
// Each entry: { topic, library, articles }
// articles = how many Learn articles to pull per topic (1-5)
const SYNC_TOPICS = [
  // Windows 11
  { topic: "Windows 11 Event Viewer activity log troubleshooting",   library: "troubleshooting", articles: 2 },
  { topic: "Windows 11 performance slow startup fix",                library: "troubleshooting", articles: 2 },
  { topic: "Windows 11 Blue Screen of Death BSOD troubleshooting",   library: "troubleshooting", articles: 2 },
  { topic: "Windows 11 Windows Update fails error fix",              library: "troubleshooting", articles: 2 },
  { topic: "Windows 11 network connectivity troubleshooting",        library: "troubleshooting", articles: 2 },
  { topic: "Windows 11 printer not working troubleshooting",         library: "troubleshooting", articles: 1 },
  { topic: "Windows 11 BitLocker enable configure recovery",         library: "runbooks",        articles: 2 },
  { topic: "Windows 11 Remote Desktop troubleshooting",             library: "troubleshooting", articles: 1 },
  { topic: "Windows 11 Task Manager performance monitoring",         library: "troubleshooting", articles: 1 },
  { topic: "Windows 11 reset factory restore options",               library: "runbooks",        articles: 1 },

  // Azure AD / Entra ID
  { topic: "Entra ID Azure AD user account locked sign-in failed",   library: "troubleshooting", articles: 2 },
  { topic: "Azure AD Multi-Factor Authentication MFA setup troubleshoot", library: "runbooks",   articles: 2 },
  { topic: "Entra ID Conditional Access policy configure",           library: "runbooks",        articles: 2 },
  { topic: "Azure AD password reset self-service SSPR configure",    library: "runbooks",        articles: 2 },
  { topic: "Azure AD group membership assign users",                 library: "runbooks",        articles: 1 },
  { topic: "Azure AD sign-in logs audit access review",              library: "troubleshooting", articles: 2 },
  { topic: "Azure AD join device register hybrid",                   library: "runbooks",        articles: 2 },

  // Microsoft Intune / Endpoint Manager
  { topic: "Intune device enrollment Windows 11 step by step",       library: "runbooks",        articles: 2 },
  { topic: "Intune compliance policy configure Windows",             library: "runbooks",        articles: 2 },
  { topic: "Intune app deployment push install",                     library: "runbooks",        articles: 2 },
  { topic: "Intune device not compliant troubleshoot",               library: "troubleshooting", articles: 2 },
  { topic: "Intune remote wipe retire device",                       library: "runbooks",        articles: 1 },

  // Microsoft Teams
  { topic: "Microsoft Teams audio video call quality troubleshooting", library: "troubleshooting", articles: 2 },
  { topic: "Microsoft Teams cannot sign in login issue fix",         library: "troubleshooting", articles: 2 },
  { topic: "Microsoft Teams meeting recording not working",          library: "troubleshooting", articles: 1 },
  { topic: "Microsoft Teams guest access external users configure",  library: "runbooks",        articles: 1 },
  { topic: "Microsoft Teams channel permissions settings",           library: "runbooks",        articles: 1 },

  // Exchange / Outlook
  { topic: "Outlook not receiving emails troubleshoot fix",          library: "troubleshooting", articles: 2 },
  { topic: "Outlook cannot connect Exchange server offline",         library: "troubleshooting", articles: 2 },
  { topic: "Exchange Online mail flow troubleshoot message trace",   library: "troubleshooting", articles: 2 },
  { topic: "Outlook profile corrupted repair recreate",              library: "runbooks",        articles: 1 },
  { topic: "Exchange Online spam quarantine manage",                 library: "runbooks",        articles: 1 },

  // OneDrive / SharePoint
  { topic: "OneDrive sync errors fix Windows 11",                    library: "troubleshooting", articles: 2 },
  { topic: "OneDrive storage full quota management",                 library: "troubleshooting", articles: 1 },
  { topic: "SharePoint permissions access denied troubleshoot",      library: "troubleshooting", articles: 2 },

  // Networking & VPN
  { topic: "Windows 11 DNS not resolving flush cache fix",           library: "troubleshooting", articles: 2 },
  { topic: "Azure VPN Point to Site setup configure",                library: "runbooks",        articles: 2 },
  { topic: "Windows 11 Wi-Fi not connecting troubleshoot",           library: "troubleshooting", articles: 2 },
  { topic: "Network adapter driver update reset Windows",            library: "troubleshooting", articles: 1 },

  // Security
  { topic: "Microsoft Defender Antivirus scan configure Windows 11", library: "runbooks",        articles: 2 },
  { topic: "Windows 11 firewall rules configure block allow",        library: "runbooks",        articles: 1 },
  { topic: "Microsoft 365 phishing email reporting protection",      library: "faqs",            articles: 2 },
  { topic: "Microsoft Secure Score improve tenant security",         library: "runbooks",        articles: 1 },

  // M365 General
  { topic: "Microsoft 365 license assign user admin center",         library: "runbooks",        articles: 1 },
  { topic: "Microsoft 365 service health check outage status",       library: "faqs",            articles: 1 },
  { topic: "Microsoft 365 admin center user management guide",       library: "runbooks",        articles: 2 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
let spToken = null, spExpiry = 0, siteId = null;

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

function getSiteId() {
  if (siteId) return Promise.resolve(siteId);
  return getToken().then(function(t) {
    return httpreq({
      hostname: "graph.microsoft.com",
      path: "/v1.0/sites/" + TENANT_NAME + ".sharepoint.com:/sites/" + SITE_NAME + ":",
      method: "GET",
      headers: { Authorization: "Bearer " + t }
    });
  }).then(function(r) { siteId = r.body.id; return siteId; });
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
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" }
      }, function(res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(fetchPageText(res.headers.location, maxLen)); return;
        }
        var data = "";
        res.on("data", function(c) { data += c; if (data.length > 200000) res.destroy(); });
        res.on("end", function() {
          var text = data
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[\s\S]*?<\/nav>/gi, "")
            .replace(/<header[\s\S]*?<\/header>/gi, "")
            .replace(/<footer[\s\S]*?<\/footer>/gi, "")
            .replace(/<[^>]+>/g, " ")
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

function searchLearn(topic, count) {
  return httpreq({
    hostname: "learn.microsoft.com",
    path: "/api/search?search=" + encodeURIComponent(topic) + "&locale=en-us&$top=" + count + "&facet=category&$filter=category%20eq%20%27Documentation%27",
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
  }).then(function(r) { return r.body.results || []; })
    .catch(function() { return []; });
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

// ── Main sync function ────────────────────────────────────────────────────────
async function syncTopic(entry) {
  var { topic, library, articles } = entry;
  var driveId = LIBRARY_DRIVES[library.toLowerCase()];
  if (!driveId) { console.log("  ⚠ Unknown library: " + library); return { ok: 0, skip: 0 }; }

  var results = await searchLearn(topic, articles);
  if (!results.length) { console.log("  ⚠ No Learn results for: " + topic); return { ok: 0, skip: 1 }; }

  var ok = 0, skip = 0;
  for (var item of results) {
    if (!item.url || !item.url.startsWith("https://learn.microsoft.com")) { skip++; continue; }
    try {
      var content = await fetchPageText(item.url, 6000);
      if (!content || content.length < 100) { skip++; continue; }
      var slug = (item.title || topic).replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-").toLowerCase().substring(0, 60);
      var filename = "learn-" + slug + ".md";
      var markdown = "# " + (item.title || topic) + "\n\n"
        + "> **Source:** " + item.url + "\n"
        + "> **Synced:** " + new Date().toISOString().split("T")[0] + "\n"
        + "> **Library:** " + library + "\n\n"
        + content;
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
    // Throttle — be polite to Learn servers
    await new Promise(function(r) { setTimeout(r, 1500); });
  }
  return { ok, skip };
}

async function main() {
  var args = process.argv.slice(2);

  if (args.includes("--list")) {
    console.log("Configured sync topics (" + SYNC_TOPICS.length + " total):\n");
    SYNC_TOPICS.forEach(function(t, i) {
      console.log((i + 1) + ". [" + t.library + "] " + t.topic + " (" + t.articles + " articles)");
    });
    return;
  }

  var topicsToRun = SYNC_TOPICS;
  if (args.length > 0 && !args[0].startsWith("--")) {
    var filter = args[0].toLowerCase();
    topicsToRun = SYNC_TOPICS.filter(function(t) { return t.topic.toLowerCase().includes(filter); });
    if (!topicsToRun.length) {
      topicsToRun = [{ topic: args[0], library: "troubleshooting", articles: 3 }];
    }
  }

  console.log("=== Claude IT Agent — Microsoft Learn KB Sync ===");
  console.log("Date: " + new Date().toISOString());
  console.log("Topics: " + topicsToRun.length + "\n");

  var totalOk = 0, totalSkip = 0;

  for (var entry of topicsToRun) {
    console.log("→ [" + entry.library + "] " + entry.topic);
    try {
      var result = await syncTopic(entry);
      totalOk   += result.ok;
      totalSkip += result.skip;
    } catch(e) {
      console.log("  ✗ Failed: " + e.message);
      totalSkip++;
    }
    // Brief pause between topics
    await new Promise(function(r) { setTimeout(r, 2000); });
  }

  console.log("\n=== Sync Complete ===");
  console.log("✓ Uploaded: " + totalOk + " articles");
  console.log("⚠ Skipped:  " + totalSkip + " articles");
  console.log("Time: " + new Date().toISOString());
}

main().catch(function(e) { console.error("Fatal error:", e); process.exit(1); });
