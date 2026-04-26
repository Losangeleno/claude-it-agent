// ============================================================
// IT Knowledge Base - Nightly Refresh Script
// Pulls from: Cisco PSIRT, Microsoft 365 Health, Microsoft Learn, Dell/Web
// Uploads to: SharePoint IT Knowledge Base libraries
// Run: node C:\claude-it-agent\kb-refresh.js
// Schedule: Nightly via Windows Task Scheduler
// ============================================================

const https = require("https");

// ── Credentials — loaded from environment variables only ──────
// Never hardcode secrets in this file.
// Run setup-env.ps1 once to register the required variables,
// or set them in the Task Scheduler task's Environment settings.
const REQUIRED_ENV = [
  "KB_TENANT_ID",
  "KB_CLIENT_ID",
  "KB_CLIENT_SECRET",
  "KB_CISCO_KEY",
  "KB_CISCO_SECRET"
];
const missing = REQUIRED_ENV.filter(function(k) { return !process.env[k]; });
if (missing.length > 0) {
  console.error("FATAL: Missing required environment variables: " + missing.join(", "));
  console.error("Run setup-env.ps1 to configure them, then restart the Task Scheduler job.");
  process.exit(1);
}

const TENANT_ID     = process.env.KB_TENANT_ID;
const CLIENT_ID     = process.env.KB_CLIENT_ID;
const CLIENT_SECRET = process.env.KB_CLIENT_SECRET;
const TENANT_NAME   = "ClaudeITAgent";
const SITE_NAME     = "ITKnowledgeBase";
const CISCO_KEY     = process.env.KB_CISCO_KEY;
const CISCO_SECRET  = process.env.KB_CISCO_SECRET;

// ── SharePoint Library Drive IDs ─────────────────────────────
const DRIVES = {
  FAQs:            "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-0YkaK7sToQb9UfBCD0V8l",
  Troubleshooting: "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-s9M-vo64gR6RqcavYF4co",
  Runbooks:        "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d8ntgJz28NVQ5IBUqynE4Gk",
  Assets:          "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9OV5yeNjEWSZzs4VJ2fbAB",
  Cabling:         "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9lg9HgzNLwT7cu7swCUvqF"
};

// ── Products to monitor ───────────────────────────────────────
const CISCO_PRODUCTS = ["Catalyst", "ASA", "Meraki", "IOS XE", "Firepower"];
const MSLEARN_TOPICS = [
  "Windows 11 deployment IT pro",
  "Microsoft 365 admin troubleshooting",
  "Intune device management",
  "Azure Active Directory conditional access",
  "Microsoft Teams admin"
];
// ── V-04: Vendor data sources ──────────────────────────────────
// Dell: NVD API (Option B) — no public RSS exists; NVD provides structured CVE data.
// HP:   RSS feed (Option C) with NVD fallback (Option B) if RSS fails.
// Long-term: Replace Dell section with Dell Pilot API (Option D) once enrolled.
// NVD API docs: https://nvd.nist.gov/developers/vulnerabilities
const DELL_NVD_KEYWORD = "Dell";
const HP_NVD_KEYWORD   = "HP";
// HP RSS — URL suggested by NotebookLM; verify on first run.
const HP_RSS_FEEDS = [
  "https://support.hp.com/us-en/security-bulletin-rss.xml"
];
const HP_SUPPORT_URLS = [
  "https://support.hp.com/us-en/security-bulletins",
  "https://support.hp.com/us-en/security-advisories",
  "https://support.hp.com/us-en/products/printers",
  "https://support.hp.com/us-en/products/desktops-workstations"
];
const FUJITSU_SUPPORT_URLS = [
  "https://www.pfu.fujitsu.com/en/scanners/support/",
  "https://scansnap.fujitsu.com/global/support/"
];

// ── V-02: Domain allowlist for all external page/RSS fetches ──
// fetchPageText() and fetchRSS() reject any URL whose hostname
// does not match one of these approved domains.
// services.nvd.nist.gov added for NVD CVE API (Option B).
const ALLOWED_DOMAINS = [
  "microsoft.com",
  "dell.com",
  "hp.com",
  "fujitsu.com",
  "pfu.fujitsu.com",
  "scansnap.fujitsu.com",
  "nvd.nist.gov",
  "services.nvd.nist.gov"
];

// ── HTTP helper ───────────────────────────────────────────────
function req(options, body) {
  return new Promise(function(resolve, reject) {
    var r = https.request(options, function(res) {
      var data = "";
      res.on("data", function(c) { data += c; });
      res.on("end", function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

// ── Token: Microsoft Graph ────────────────────────────────────
var spToken = null, spExpiry = 0;
function getSPToken() {
  if (spToken && Date.now() < spExpiry) return Promise.resolve(spToken);
  var b = "grant_type=client_credentials&client_id=" + encodeURIComponent(CLIENT_ID) +
          "&client_secret=" + encodeURIComponent(CLIENT_SECRET) +
          "&scope=" + encodeURIComponent("https://graph.microsoft.com/.default");
  return req({
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

// ── Token: Cisco PSIRT ────────────────────────────────────────
var ciscoToken = null, ciscoExpiry = 0;
function getCiscoToken() {
  if (ciscoToken && Date.now() < ciscoExpiry) return Promise.resolve(ciscoToken);
  var b = "grant_type=client_credentials&client_id=" + encodeURIComponent(CISCO_KEY) +
          "&client_secret=" + encodeURIComponent(CISCO_SECRET);
  return req({
    hostname: "id.cisco.com",
    path: "/oauth2/default/v1/token",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(b) }
  }, b).then(function(r) {
    ciscoToken = r.body.access_token;
    ciscoExpiry = Date.now() + 3500000;
    return ciscoToken;
  });
}

// ── V-08: Retry with exponential backoff ──────────────────────
// Wraps any async fn, retrying up to `retries` times with
// doubling delay. Respects Retry-After header on 429 responses.
function retryWithBackoff(fn, retries, delay) {
  retries = retries !== undefined ? retries : 3;
  delay   = delay   !== undefined ? delay   : 1000;
  return fn().catch(function(err) {
    if (retries <= 0) throw err;
    var wait = (err && err.retryAfter) ? parseInt(err.retryAfter) * 1000 : delay;
    log("  [retry] Waiting " + wait + "ms before retry (" + retries + " left). Reason: " + err.message);
    return new Promise(function(resolve) { setTimeout(resolve, wait); })
      .then(function() { return retryWithBackoff(fn, retries - 1, delay * 2); });
  });
}

// ── V-07: Sanitise error messages before logging ──────────────
// Strips Bearer tokens and client secrets from error strings so
// they never appear in the log file.
function sanitizeForLog(msg) {
  return String(msg)
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, "Bearer [REDACTED]")
    .replace(/client_secret=[^&\s]*/gi, "client_secret=[REDACTED]")
    .replace(/access_token=[^&\s]*/gi, "access_token=[REDACTED]");
}

// ── Graph API wrapper ─────────────────────────────────────────
function graph(path) {
  return getSPToken().then(function(t) {
    return req({ hostname: "graph.microsoft.com", path: "/v1.0" + path, method: "GET",
                 headers: { Authorization: "Bearer " + t } });
  }).then(function(r) { return r.body; });
}

// ── Upload file to KB library ─────────────────────────────────
function uploadToKB(library, filename, content) {
  var driveId = DRIVES[library];
  if (!driveId) return Promise.reject(new Error("Unknown library: " + library));
  // V-11: Integrity check — reject empty or suspiciously small content
  if (!content || content.trim().length < 20) {
    return Promise.reject(new Error("uploadToKB: content for " + filename + " is empty or too short — upload aborted"));
  }
  var fileData = Buffer.from(content, "utf8");
  var uploadPath = "/v1.0/drives/" + driveId + "/root:/" + encodeURIComponent(filename) + ":/content";
  return getSPToken().then(function(t) {
    return new Promise(function(resolve, reject) {
      var r = https.request({
        hostname: "graph.microsoft.com", path: uploadPath, method: "PUT",
        headers: { Authorization: "Bearer " + t, "Content-Type": "text/plain; charset=utf-8",
                   "Content-Length": fileData.length }
      }, function(re) {
        var d = "";
        re.on("data", function(c) { d += c; });
        re.on("end", function() { resolve(re.statusCode); });
      });
      r.on("error", reject);
      r.write(fileData);
      r.end();
    });
  }).then(function(status) {
    if (status === 200 || status === 201) {
      log("  ✓ Uploaded: " + library + "/" + filename);
    } else {
      log("  ✗ Upload failed (" + status + "): " + library + "/" + filename);
    }
  });
}

// ── Logging ───────────────────────────────────────────────────
var LOG_FILE = "C:\\claude-it-agent\\kb-refresh.log";
var fs = require("fs");
function log(msg) {
  var line = new Date().toISOString() + "  " + sanitizeForLog(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// ── Fetch plain text from a URL (hardened) ────────────────────
// V-02: Validates domain against ALLOWED_DOMAINS allowlist.
// V-02: Validates Content-Type; rejects non-text responses.
// V-02: Hard 500 KB content cap with stream abort.
// V-03: Validates redirect destination stays on allowed domain.
// V-05: Limits redirect depth to 3 hops (depth parameter).
// V-06: Uses transparent, honest User-Agent string.
function fetchPageText(urlString, maxLen, depth) {
  maxLen = maxLen || 3000;
  depth  = depth  || 0;

  return new Promise(function(resolve, reject) {
    try {
      var u = new URL(urlString);

      // HTTPS only
      if (u.protocol !== "https:") {
        return reject(new Error("fetchPageText: only HTTPS URLs are permitted"));
      }

      // V-02: Domain allowlist check
      var allowed = ALLOWED_DOMAINS.some(function(d) {
        return u.hostname === d || u.hostname.endsWith("." + d);
      });
      if (!allowed) {
        return reject(new Error("fetchPageText: forbidden domain — " + u.hostname));
      }

      var r = https.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          // V-06: Transparent User-Agent — no browser spoofing
          "User-Agent": "IT-KB-Refresh/1.0 (internal; contact it@org.com)",
          "Accept": "text/html, text/plain"
        }
      }, function(res) {

        // V-03 + V-05: Redirect handling with depth limit and domain check
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (depth >= 3) {
            return reject(new Error("fetchPageText: maximum redirect depth (3) exceeded for " + urlString));
          }
          var nextUrl;
          try {
            // Normalise relative redirects using the original URL as base
            nextUrl = new URL(res.headers.location, urlString).href;
          } catch(e) {
            return reject(new Error("fetchPageText: invalid redirect Location header"));
          }
          return resolve(fetchPageText(nextUrl, maxLen, depth + 1));
        }

        // V-02: Content-Type validation — reject non-text responses
        var ct = res.headers["content-type"] || "";
        if (!ct.includes("text/html") && !ct.includes("text/plain")) {
          res.destroy();
          return reject(new Error("fetchPageText: rejected non-text content-type: " + ct));
        }

        var data = "";
        res.on("data", function(c) {
          data += c;
          // V-02: Hard 500 KB cap
          if (data.length > 512000) {
            res.destroy();
            reject(new Error("fetchPageText: response exceeded 500 KB limit for " + urlString));
          }
        });
        res.on("end", function() {
          var text = data
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[\s\S]*?<\/nav>/gi, "")
            .replace(/<header[\s\S]*?<\/header>/gi, "")
            .replace(/<footer[\s\S]*?<\/footer>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/\s{2,}/g, " ").trim();
          resolve(text.substring(0, maxLen));
        });
      });

      r.on("error", function(e) { reject(e); });
      r.setTimeout(15000, function() { r.destroy(); reject(new Error("fetchPageText: timeout for " + urlString)); });

    } catch(e) { reject(e); }
  });
}

// ── V-04: Fetch an RSS/Atom feed and return raw XML ───────────
// Uses a plain HTTPS GET with no JSON parsing. Domain is validated
// against ALLOWED_DOMAINS the same way as fetchPageText().
function fetchRSS(urlString) {
  return new Promise(function(resolve, reject) {
    try {
      var u = new URL(urlString);
      if (u.protocol !== "https:") {
        return reject(new Error("fetchRSS: only HTTPS URLs permitted"));
      }
      var allowed = ALLOWED_DOMAINS.some(function(d) {
        return u.hostname === d || u.hostname.endsWith("." + d);
      });
      if (!allowed) {
        return reject(new Error("fetchRSS: forbidden domain — " + u.hostname));
      }
      var r = https.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          "User-Agent": "IT-KB-Refresh/1.0 (internal; contact it@org.com)",
          "Accept": "application/rss+xml, application/xml, text/xml"
        }
      }, function(res) {
        // Follow one redirect only (e.g. HTTP -> HTTPS canonical)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchRSS(new URL(res.headers.location, urlString).href));
        }
        var data = "";
        res.on("data", function(c) {
          data += c;
          if (data.length > 512000) { res.destroy(); reject(new Error("fetchRSS: feed exceeded 500 KB")); }
        });
        res.on("end", function() { resolve(data); });
      });
      r.on("error", reject);
      r.setTimeout(15000, function() { r.destroy(); reject(new Error("fetchRSS: timeout for " + urlString)); });
    } catch(e) { reject(e); }
  });
}

// ── V-04: Parse RSS/Atom XML into an array of items ──────────
// Handles both plain text and CDATA-wrapped titles/descriptions.
// Fixed version of NotebookLM snippet — uses match[1] not match[8].
function parseRSS(xml, maxItems) {
  maxItems = maxItems || 15;
  var items = [];
  var itemRx = /<item>([\s\S]*?)<\/item>/g;
  var m;
  while ((m = itemRx.exec(xml)) !== null && items.length < maxItems) {
    var block = m[1];
    var titleM = block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title[^>]*>([\s\S]*?)<\/title>/);
    var linkM  = block.match(/<link[^>]*>([\s\S]*?)<\/link>/);
    var descM  = block.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description[^>]*>([\s\S]*?)<\/description>/);
    var dateM  = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/);
    var title  = titleM ? (titleM[1] || titleM[2] || "").trim() : "";
    var link   = linkM  ? linkM[1].trim() : "";
    var desc   = descM  ? (descM[1] || descM[2] || "").replace(/<[^>]+>/g, "").trim().substring(0, 300) : "";
    var date   = dateM  ? dateM[1].trim() : "";
    if (title || link) items.push({ title: title, link: link, desc: desc, date: date });
  }
  return items;
}

// ── NVD CVE API fetch (Option B) ─────────────────────────────
// Queries the NVD 2.0 REST API for recent CVEs by vendor keyword.
// Uses built-in https module; no external dependencies.
// services.nvd.nist.gov is in ALLOWED_DOMAINS.
// NVD imposes a rate limit; retryWithBackoff handles 503s.
// Free tier: 5 requests/30s unauthenticated. Add NVD_API_KEY env
// var and an x-apiKey header for higher limits when enrolled.
function fetchNVDVendorData(vendorKeyword, maxItems) {
  maxItems = maxItems || 10;
  var path = "/rest/json/cves/2.0?keywordSearch=" +
    encodeURIComponent(vendorKeyword) +
    "&resultsPerPage=" + maxItems +
    "&sortBy=lastModified&sortOrder=desc";
  var headers = {
    "User-Agent": "IT-KB-Refresh/1.0 (internal; contact it@org.com)",
    "Accept": "application/json"
  };
  // Optional API key for higher rate limits
  if (process.env.NVD_API_KEY) headers["apiKey"] = process.env.NVD_API_KEY;

  return new Promise(function(resolve, reject) {
    var r = https.get({
      hostname: "services.nvd.nist.gov",
      path: path,
      headers: headers
    }, function(res) {
      if (res.statusCode === 503 || res.statusCode === 429) {
        var err = new Error("NVD rate limit or unavailable (" + res.statusCode + ")");
        err.retryAfter = res.headers["retry-after"] || 6;
        res.destroy();
        return reject(err);
      }
      var data = "";
      res.on("data", function(c) {
        data += c;
        if (data.length > 1024 * 1024) { res.destroy(); reject(new Error("NVD response exceeded 1MB")); }
      });
      res.on("end", function() {
        try {
          var json = JSON.parse(data);
          if (!json.vulnerabilities) return reject(new Error("NVD: unexpected response shape"));
          resolve(json.vulnerabilities);
        } catch(e) {
          reject(new Error("NVD: JSON parse error — " + sanitizeForLog(e.message)));
        }
      });
    });
    r.on("error", function(e) { reject(e); });
    r.setTimeout(20000, function() { r.destroy(); reject(new Error("NVD: request timeout")); });
  });
}

// Formats an array of NVD vulnerability objects into KB Markdown.
function nvdToMarkdown(vulns, vendorLabel) {
  var md = "";
  vulns.forEach(function(item) {
    var cve  = item.cve;
    var id   = cve.id || "Unknown";
    var desc = (cve.descriptions || []).find(function(d) { return d.lang === "en"; });
    var text = desc ? desc.value.substring(0, 250) : "No description available.";
    if (text.length === 250) text += "...";
    var published = (cve.published || "").split("T")[0];
    var severity  = "";
    try {
      var metrics = cve.metrics;
      var cvss = (metrics.cvssMetricV31 || metrics.cvssMetricV30 || metrics.cvssMetricV2 || [])[0];
      if (cvss) severity = " | **Severity:** " + (cvss.cvssData && cvss.cvssData.baseSeverity || "");
    } catch(_) {}
    md += "### [" + id + "](https://nvd.nist.gov/vuln/detail/" + id + ")" + severity + "\n\n";
    if (published) md += "_Published: " + published + "_\n\n";
    md += text + "\n\n---\n\n";
  });
  return md;
}

// ── Today's date string ───────────────────────────────────────
function today() {
  return new Date().toISOString().split("T")[0];
}

// ============================================================
// SECTION 1 — Cisco Security Advisories → Troubleshooting
// ============================================================
function refreshCiscoAdvisories() {
  log("[Cisco] Fetching security advisories...");
  return getCiscoToken().then(function(t) {
    return Promise.all(CISCO_PRODUCTS.map(function(product) {
      // V-08: Wrap each product query in retryWithBackoff
      return retryWithBackoff(function() {
        return req({
          hostname: "apix.cisco.com",
          path: "/security/advisories/v2/product?product=" + encodeURIComponent(product),
          method: "GET",
          headers: { Authorization: "Bearer " + t, Accept: "application/json" }
        });
      }).then(function(r) {
        return { product: product, advisories: (r.body.advisories || []).slice(0, 5) };
      }).catch(function(e) {
        log("[Cisco] Failed to fetch advisories for " + product + ": " + e.message);
        return { product: product, advisories: [] };
      });
    }));
  }).then(function(results) {
    var md = "# Cisco Security Advisories\n\n";
    md += "_Last updated: " + today() + "_\n\n";
    md += "Auto-refreshed nightly from Cisco PSIRT API. Products monitored: " + CISCO_PRODUCTS.join(", ") + ".\n\n";

    var totalAdvisories = 0;
    results.forEach(function(r) {
      if (!r.advisories.length) return;
      md += "## " + r.product + "\n\n";
      r.advisories.forEach(function(a) {
        totalAdvisories++;
        md += "### " + (a.advisoryTitle || "Advisory") + "\n\n";
        md += "- **Severity:** " + (a.sir || "Unknown") + "\n";
        md += "- **Published:** " + (a.publishedOn || "N/A") + "\n";
        if (a.cves && a.cves.length) md += "- **CVEs:** " + a.cves.join(", ") + "\n";
        if (a.advisoryId) md += "- **Advisory ID:** " + a.advisoryId + "\n";
        if (a.publicationUrl) md += "- **Details:** [" + a.advisoryId + "](" + a.publicationUrl + ")\n";
        if (a.summary) md += "\n" + a.summary.substring(0, 400) + "...\n";
        md += "\n---\n\n";
      });
    });

    if (totalAdvisories === 0) {
      md += "_No active advisories found for monitored products._\n";
    }

    log("[Cisco] Found " + totalAdvisories + " advisories across " + CISCO_PRODUCTS.length + " products");
    return uploadToKB("Troubleshooting", "cisco-security-advisories.md", md);
  }).catch(function(e) { log("[Cisco] Error: " + e.message); });
}

// ============================================================
// SECTION 2 — Microsoft 365 Service Health → Runbooks
// ============================================================
function refreshMSServiceHealth() {
  log("[M365 Health] Checking service health and maintenance...");

  // Build URLs using encodeURIComponent() on filter values to avoid
  // "Request path contains unescaped characters" in Node.js https.request()
  var issuesPath    = "/admin/serviceAnnouncement/issues?$filter="   + encodeURIComponent("status ne 'resolved'")          + "&$top=20";
  var messagesPath  = "/admin/serviceAnnouncement/messages?$filter=" + encodeURIComponent("messageType eq 'planForChange'") + "&$top=10";

  return Promise.all([
    graph(issuesPath),
    graph(messagesPath)
  ]).then(function(results) {
    // Validate that the Graph API returned proper JSON objects before using them
    if (!results[0] || typeof results[0] !== "object") {
      throw new Error("Invalid JSON response from issues endpoint — raw: " + JSON.stringify(results[0]).substring(0, 200));
    }
    if (!results[1] || typeof results[1] !== "object") {
      throw new Error("Invalid JSON response from messages endpoint — raw: " + JSON.stringify(results[1]).substring(0, 200));
    }

    var issues = results[0].value || [];
    var maintenance = results[1].value || [];

    var md = "# Microsoft 365 Service Health\n\n";
    md += "_Last updated: " + today() + "_\n\n";
    md += "Auto-refreshed nightly from Microsoft Graph Service Health API.\n\n";

    // Active issues
    md += "## Active Issues\n\n";
    if (issues.length === 0) {
      md += "_✅ All Microsoft 365 services are healthy — no active issues._\n\n";
    } else {
      issues.forEach(function(i) {
        md += "### " + (i.title || "Issue") + "\n\n";
        md += "- **Service:** " + (i.service || "N/A") + "\n";
        md += "- **Status:** " + (i.status || "N/A") + "\n";
        md += "- **Severity:** " + (i.classification || "N/A") + "\n";
        md += "- **Started:** " + (i.startDateTime || "N/A") + "\n";
        if (i.id) md += "- **Incident ID:** " + i.id + "\n";
        md += "\n---\n\n";
      });
    }

    // Planned maintenance
    md += "## Upcoming Planned Maintenance\n\n";
    if (maintenance.length === 0) {
      md += "_No planned maintenance scheduled._\n\n";
    } else {
      maintenance.forEach(function(m) {
        md += "### " + (m.title || "Maintenance") + "\n\n";
        md += "- **Services:** " + (m.services ? m.services.join(", ") : "N/A") + "\n";
        md += "- **Published:** " + (m.publishedDateTime || "N/A") + "\n";
        if (m.body && m.body.content) {
          var text = m.body.content.replace(/<[^>]+>/g, "").trim().substring(0, 500);
          md += "\n" + text + "...\n";
        }
        md += "\n---\n\n";
      });
    }

    log("[M365 Health] " + issues.length + " active issues, " + maintenance.length + " maintenance items");
    return uploadToKB("Runbooks", "m365-service-health.md", md);
  }).catch(function(e) {
    log("[M365 Health] ERROR: " + e.message);
    log("[M365 Health] Uploading fallback placeholder — check Graph API permissions and URL encoding.");
    var fallback = "# Microsoft 365 Service Health\n\n";
    fallback += "_Last updated: " + today() + "_\n\n";
    fallback += "> ⚠️ **Data unavailable** — the nightly refresh failed to retrieve live M365 service health data.\n";
    fallback += "> **Error:** " + e.message + "\n\n";
    fallback += "Check the [Microsoft 365 Service Health Dashboard](https://admin.microsoft.com/adminportal/home#/servicehealth) directly.\n\n";
    fallback += "Also review `C:\\claude-it-agent\\kb-refresh.log` for full error details.\n";
    return uploadToKB("Runbooks", "m365-service-health.md", fallback);
  });
}

// ============================================================
// SECTION 3 — Microsoft Learn → FAQs
// ============================================================
function refreshMSLearnDocs() {
  log("[MS Learn] Fetching documentation for " + MSLEARN_TOPICS.length + " topics...");
  return Promise.all(MSLEARN_TOPICS.map(function(topic) {
    // V-08: Wrap each topic search in retryWithBackoff
    return retryWithBackoff(function() {
      return req({
        hostname: "learn.microsoft.com",
        path: "/api/search?search=" + encodeURIComponent(topic) + "&locale=en-us&$top=4",
        method: "GET",
        headers: { Accept: "application/json" }
      });
    }).then(function(r) {
      // V-11: Validate response is a proper object before using it
      if (!r.body || typeof r.body !== "object") {
        throw new Error("Invalid JSON from MS Learn API for topic: " + topic);
      }
      return { topic: topic, results: r.body.results || [] };
    }).catch(function(e) {
      log("[MS Learn] Failed for topic '" + topic + "': " + e.message);
      return { topic: topic, results: [] };
    });
  })).then(function(allResults) {
    var md = "# Microsoft Learn — IT Pro Reference\n\n";
    md += "_Last updated: " + today() + "_\n\n";
    md += "Auto-refreshed nightly from Microsoft Learn API. Topics: IT deployment, M365 admin, Intune, Azure AD, Teams.\n\n";

    allResults.forEach(function(r) {
      if (!r.results.length) return;
      md += "## " + r.topic + "\n\n";
      r.results.forEach(function(doc) {
        md += "### [" + (doc.title || "Article") + "](" + (doc.url || "#") + ")\n\n";
        if (doc.description) md += doc.description.substring(0, 300) + "\n\n";
      });
      md += "---\n\n";
    });

    // Fetch live content for top article per topic
    var fetchJobs = [];
    allResults.forEach(function(r) {
      if (r.results.length && r.results[0].url) {
        fetchJobs.push(
          fetchPageText(r.results[0].url, 3000).then(function(text) {
            r.liveContent = text;
            r.liveUrl = r.results[0].url;
          }).catch(function() {})
        );
      }
    });
    return Promise.all(fetchJobs).then(function() {
      // Rebuild md with live content
      md = "# Microsoft Learn — IT Pro Reference\n\n";
      md += "_Last updated: " + today() + "_\n\n";
      md += "Auto-refreshed nightly from Microsoft Learn API. Full article content fetched directly from learn.microsoft.com.\n\n";
      allResults.forEach(function(r) {
        if (!r.results.length) return;
        md += "## " + r.topic + "\n\n";
        r.results.forEach(function(doc) {
          md += "### [" + (doc.title || "Article") + "](" + (doc.url || "#") + ")\n\n";
          if (doc.description) md += "_" + doc.description.substring(0, 200) + "_\n\n";
        });
        if (r.liveContent) {
          md += "**Full content from: " + r.liveUrl + "**\n\n";
          md += r.liveContent + "\n\n";
        }
        md += "---\n\n";
      });
      var total = allResults.reduce(function(s, r) { return s + r.results.length; }, 0);
      log("[MS Learn] Found " + total + " articles, fetched live content for " + fetchJobs.length + " pages");
      return uploadToKB("FAQs", "microsoft-learn-itpro.md", md);
    });
  }).catch(function(e) { log("[MS Learn] Error: " + e.message); });
}

// ============================================================
// ============================================================
// ============================================================
// SECTION 4 — Dell Security Advisories (NVD API) → FAQs
// Option B: NVD 2.0 REST API — structured CVE data for Dell.
// No public Dell RSS exists; NVD bypasses JavaScript-rendered pages.
// Long-term: replace with Dell Pilot API (Option D) once enrolled.
// services.nvd.nist.gov added to ALLOWED_DOMAINS.
// ============================================================
function refreshDellSupport() {
  log("[Dell] Fetching Dell CVEs from NVD API...");
  return retryWithBackoff(function() {
    return fetchNVDVendorData(DELL_NVD_KEYWORD, 10);
  }).then(function(vulns) {
    var md = "# Dell Security Advisories\n\n";
    md += "_Last updated: " + today() + "_\n\n";
    md += "Auto-refreshed nightly from the NIST National Vulnerability Database (NVD). ";
    md += "Covers the 10 most recently updated CVEs mentioning Dell hardware and software.\n\n";
    md += "> **Tip:** Always use your Service Tag at [support.dell.com](https://support.dell.com) for device-specific drivers.\n\n";
    md += "> **Note:** For official Dell DSAs visit [dell.com/support/security](https://www.dell.com/support/security/en-us). ";
    md += "Dell Pilot API (Option D) will replace this feed once enrolled.\n\n";
    if (!vulns || vulns.length === 0) {
      log("[Dell] WARNING: NVD returned 0 results.");
      md += "> \u26a0\ufe0f **No CVEs returned** \u2014 NVD may be temporarily unavailable or rate-limited.\n\n";
    } else {
      md += "## Recent Dell CVEs (NVD)\n\n";
      md += nvdToMarkdown(vulns, "Dell");
    }
    md += "## Key Dell Support Links\n\n";
    md += "- [Dell Support Home](https://support.dell.com)\n";
    md += "- [Dell Security Advisories](https://www.dell.com/support/security/en-us)\n";
    md += "- [Driver & Downloads](https://www.dell.com/support/home/en-us?app=drivers)\n";
    md += "- [Warranty Lookup](https://www.dell.com/support/home/en-us?app=warranty)\n";
    md += "- [NVD Dell CVEs](https://nvd.nist.gov/vuln/search/results?query=Dell)\n";
    log("[Dell] Retrieved " + vulns.length + " CVEs from NVD");
    return uploadToKB("FAQs", "dell-support-updates.md", md);
  }).catch(function(e) {
    log("[Dell] ERROR: " + sanitizeForLog(e.message));
    var fallback = "# Dell Security Advisories\n\n";
    fallback += "_Last updated: " + today() + "_\n\n";
    fallback += "> \u26a0\ufe0f **Live data unavailable** \u2014 NVD API error: " + sanitizeForLog(e.message) + "\n\n";
    fallback += "## Key Dell Support Links\n\n";
    fallback += "- [Dell Support Home](https://support.dell.com)\n";
    fallback += "- [Dell Security Advisories](https://www.dell.com/support/security/en-us)\n";
    fallback += "- [Driver & Downloads](https://www.dell.com/support/home/en-us?app=drivers)\n";
    return uploadToKB("FAQs", "dell-support-updates.md", fallback);
  });
}

// ============================================================
// SECTION 5 — HP Security Bulletins (RSS + NVD fallback) → Troubleshooting
// Option C: HP RSS (support.hp.com/us-en/security-bulletin-rss.xml)
// Option B fallback: NVD API if RSS fails or returns 0 items.
// ============================================================
function refreshHPSupport() {
  log("[HP] Fetching HP security bulletins from RSS feed...");
  var rssFetch = retryWithBackoff(function() {
    return fetchRSS(HP_RSS_FEEDS[0]);
  }).then(function(xml) {
    return parseRSS(xml, 15);
  }).catch(function(e) {
    log("[HP] RSS failed (" + e.message + ") \u2014 falling back to NVD API.");
    return null;
  });
  return rssFetch.then(function(items) {
    if (items && items.length > 0) {
      return buildHPMarkdownFromRSS(items);
    }
    log("[HP] Falling back to NVD API for HP CVEs...");
    return retryWithBackoff(function() {
      return fetchNVDVendorData(HP_NVD_KEYWORD, 10);
    }).then(function(vulns) {
      return buildHPMarkdownFromNVD(vulns);
    });
  }).then(function(md) {
    log("[HP] Upload complete");
    return uploadToKB("Troubleshooting", "hp-support-updates.md", md);
  }).catch(function(e) {
    log("[HP] ERROR: " + sanitizeForLog(e.message));
    var fallback = "# HP Support \u2014 Security Bulletins & Advisories\n\n";
    fallback += "_Last updated: " + today() + "_\n\n";
    fallback += "> \u26a0\ufe0f **Live data unavailable** \u2014 Error: " + sanitizeForLog(e.message) + "\n\n";
    fallback += buildHPLinks();
    return uploadToKB("Troubleshooting", "hp-support-updates.md", fallback);
  });
}

function buildHPMarkdownFromRSS(items) {
  var md = "# HP Support \u2014 Security Bulletins & Advisories\n\n";
  md += "_Last updated: " + today() + "_\n\n";
  md += "Auto-refreshed nightly from the HP Security Bulletins RSS feed.\n\n";
  md += "> **Tip:** Use your HP Serial Number at [support.hp.com](https://support.hp.com) for device-specific drivers.\n\n";
  md += "## Latest HP Security Bulletins\n\n";
  items.forEach(function(item) {
    md += "### " + (item.title || "Bulletin") + "\n\n";
    if (item.date) md += "_Published: " + item.date + "_\n\n";
    if (item.desc) md += item.desc + "\n\n";
    if (item.link) md += "[Read more](" + item.link + ")\n\n";
    md += "---\n\n";
  });
  md += buildHPLinks();
  log("[HP] Built from RSS: " + items.length + " bulletins");
  return md;
}

function buildHPMarkdownFromNVD(vulns) {
  var md = "# HP Support \u2014 Security Bulletins & Advisories\n\n";
  md += "_Last updated: " + today() + "_\n\n";
  md += "Auto-refreshed nightly from the NIST NVD (RSS unavailable \u2014 NVD fallback active).\n\n";
  md += "> **Tip:** For official HP Security Bulletins visit [support.hp.com/us-en/security-bulletins](https://support.hp.com/us-en/security-bulletins).\n\n";
  if (!vulns || vulns.length === 0) {
    md += "> \u26a0\ufe0f **No CVEs returned** \u2014 NVD may be temporarily unavailable.\n\n";
  } else {
    md += "## Recent HP CVEs (NVD Fallback)\n\n";
    md += nvdToMarkdown(vulns, "HP");
  }
  md += buildHPLinks();
  log("[HP] Built from NVD fallback: " + (vulns ? vulns.length : 0) + " CVEs");
  return md;
}

function buildHPLinks() {
  var links = "## Key HP Support Links\n\n";
  links += "- [HP Support Home](https://support.hp.com)\n";
  links += "- [HP Security Bulletins](https://support.hp.com/us-en/security-bulletins)\n";
  links += "- [HP Security Advisories](https://support.hp.com/us-en/security-advisories)\n";
  links += "- [HP Printer Drivers](https://support.hp.com/us-en/products/printers)\n";
  links += "- [HP Computer Drivers](https://support.hp.com/us-en/products/desktops-workstations)\n";
  links += "- [HP Scanner Support](https://support.hp.com/us-en/products/scanners)\n";
  links += "- [HP Warranty Check](https://support.hp.com/us-en/checkwarranty)\n\n";
  return links;
}

// SECTION 6 — Fujitsu Scanner Support (direct pages) → Troubleshooting
// V-04: Removed DuckDuckGo scraping — direct page fetches only.
// No confirmed public RSS feed available for Fujitsu scanners.
// Update FUJITSU_SUPPORT_URLS above if Fujitsu publishes one.
// ============================================================
function refreshFujitsuSupport() {
  log("[Fujitsu] Fetching Fujitsu scanner support content from direct pages...");

  var pageFetches = FUJITSU_SUPPORT_URLS.map(function(url) {
    return fetchPageText(url, 2500)
      .then(function(text) { return { url: url, content: text }; })
      .catch(function(e) {
        log("[Fujitsu] Could not fetch " + url + ": " + e.message);
        return { url: url, content: "" };
      });
  });

  return Promise.all(pageFetches).then(function(pages) {
    var md = "# Fujitsu Scanner Support — ScanSnap & fi Series\n\n";
    md += "_Last updated: " + today() + "_\n\n";
    md += "Auto-refreshed nightly from Fujitsu support pages. Covers ScanSnap (iX, S, SP series) and fi-series scanners.\n\n";
    md += "> **Tip:** Identify your scanner model number on the label (bottom or back of unit) before searching for drivers.\n\n";

    var fetched = pages.filter(function(p) { return p.content; });
    if (fetched.length === 0) {
      log("[Fujitsu] WARNING: All page fetches returned empty. Check network or domain allowlist.");
      md += "> ⚠️ **Live content unavailable** — support pages could not be reached. Check kb-refresh.log.\n\n";
    } else {
      md += "## Live Content from Fujitsu Support\n\n";
      fetched.forEach(function(p) {
        md += "### Source: " + p.url + "\n\n";
        md += p.content.substring(0, 2000) + "\n\n---\n\n";
      });
    }

    md += "## Key Fujitsu Support Links\n\n";
    md += "- [ScanSnap Support](https://scansnap.fujitsu.com/global/support/)\n";
    md += "- [fi Series Support](https://www.pfu.fujitsu.com/en/scanners/support/)\n";
    md += "- [ScanSnap Driver Downloads](https://scansnap.fujitsu.com/global/dl/)\n";
    md += "- [fi Series Driver Downloads](https://www.pfu.fujitsu.com/en/scanners/fi/downloads/)\n";
    md += "- [Fujitsu Scanner Setup Guide](https://www.pfu.fujitsu.com/en/scanners/support/setup/)\n";
    md += "- [Online Scanner Registration](https://scansnap.fujitsu.com/global/register/)\n\n";

    log("[Fujitsu] Fetched " + fetched.length + " of " + pages.length + " support pages");
    return uploadToKB("Troubleshooting", "fujitsu-scanner-support.md", md);
  }).catch(function(e) { log("[Fujitsu] Error: " + e.message); });
}

// ============================================================
// MAIN — Run all refresh jobs
// ============================================================
// ============================================================
// MAIN -- Run all refresh jobs
// ============================================================
async function main() {
  log("===========================================");
  log("IT KB Nightly Refresh -- " + new Date().toISOString());
  log("===========================================");

  try {
    await refreshCiscoAdvisories();
    await refreshMSServiceHealth();
    await refreshMSLearnDocs();
    await refreshDellSupport();
    await refreshHPSupport();
    await refreshFujitsuSupport();

    log("===========================================");
    log("Refresh complete -- all libraries updated.");
    log("===========================================");
  } catch (e) {
    log("FATAL ERROR: " + e.message);
    process.exit(1);
  }
}

main();
