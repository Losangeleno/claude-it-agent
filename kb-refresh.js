// ============================================================
// IT Knowledge Base - Nightly Refresh Script
// Pulls from: Cisco PSIRT, Microsoft 365 Health, Microsoft Learn, Dell/Web
// Uploads to: SharePoint IT Knowledge Base libraries
// Run: node C:\claude-it-agent\kb-refresh.js
// Schedule: Nightly via Windows Task Scheduler
// ============================================================

const https = require("https");

// ── Credentials ──────────────────────────────────────────────
const TENANT_ID     = "e876d5db-a9f8-4e71-abc1-dcee4d8b0578";
const CLIENT_ID     = "50d28fcf-1e66-452f-be81-36b40b640605";
const CLIENT_SECRET = "OCy8Q~qnTAqtSfK.8bIdnKVqcCv46zMFGkIhQbtc";
const TENANT_NAME   = "ClaudeITAgent";
const SITE_NAME     = "ITKnowledgeBase";
const CISCO_KEY     = "qtbj2x2knjbmewmnt3kss8hy";
const CISCO_SECRET  = "g7MRPgWGBPdaKcAQTuxDGqBB";

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
const DELL_SEARCHES = [
  "Dell OptiPlex driver update 2026",
  "Dell Latitude BIOS firmware 2026",
  "Dell PowerEdge firmware advisory"
];
const HP_SEARCHES = [
  "HP LaserJet printer firmware update 2026",
  "HP EliteBook ProBook driver update 2026",
  "HP ScanJet scanner firmware 2026"
];
const FUJITSU_SEARCHES = [
  "Fujitsu ScanSnap scanner driver update 2026",
  "Fujitsu fi series scanner firmware 2026"
];
const HP_SUPPORT_URLS = [
  "https://support.hp.com/us-en/security-advisories",
  "https://support.hp.com/us-en/products/printers",
  "https://support.hp.com/us-en/products/desktops-workstations"
];
const FUJITSU_SUPPORT_URLS = [
  "https://www.pfu.fujitsu.com/en/scanners/support/",
  "https://scansnap.fujitsu.com/global/support/"
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
  var line = new Date().toISOString() + "  " + msg;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// ── Fetch plain text from a URL ───────────────────────────────
function fetchPageText(urlString, maxLen) {
  maxLen = maxLen || 3000;
  return new Promise(function(resolve) {
    try {
      var u = new URL(urlString);
      if (u.protocol !== "https:") { resolve(""); return; }
      var r = https.get({
        hostname: u.hostname, path: u.pathname + u.search,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" }
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
            .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/\s{2,}/g, " ").trim();
          resolve(text.substring(0, maxLen));
        });
      });
      r.on("error", function() { resolve(""); });
      r.setTimeout(15000, function() { r.destroy(); resolve(""); });
    } catch(e) { resolve(""); }
  });
}

// ── Today's date string ───────────────────────────────────────
function today() {
  return new Date().toISOString().split("T")[0];
}

// ════════════════════════════════════════════════════════════
// SECTION 1 — Cisco Security Advisories → Troubleshooting
// ════════════════════════════════════════════════════════════
function refreshCiscoAdvisories() {
  log("[Cisco] Fetching security advisories...");
  return getCiscoToken().then(function(t) {
    return Promise.all(CISCO_PRODUCTS.map(function(product) {
      return req({
        hostname: "apix.cisco.com",
        path: "/security/advisories/v2/product?product=" + encodeURIComponent(product),
        method: "GET",
        headers: { Authorization: "Bearer " + t, Accept: "application/json" }
      }).then(function(r) {
        return { product: product, advisories: (r.body.advisories || []).slice(0, 5) };
      }).catch(function() { return { product: product, advisories: [] }; });
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

// ════════════════════════════════════════════════════════════
// SECTION 2 — Microsoft 365 Service Health → Runbooks
// ════════════════════════════════════════════════════════════
function refreshMSServiceHealth() {
  log("[M365 Health] Checking service health and maintenance...");
  return Promise.all([
    graph("/admin/serviceAnnouncement/issues?$filter=status%20ne%20%27resolved%27&$top=20"),
    graph("/admin/serviceAnnouncement/messages?$filter=messageType%20eq%20%27planForChange%27&$top=10")
  ]).then(function(results) {
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
  }).catch(function(e) { log("[M365 Health] Error: " + e.message); });
}

// ════════════════════════════════════════════════════════════
// SECTION 3 — Microsoft Learn → FAQs
// ════════════════════════════════════════════════════════════
function refreshMSLearnDocs() {
  log("[MS Learn] Fetching documentation for " + MSLEARN_TOPICS.length + " topics...");
  return Promise.all(MSLEARN_TOPICS.map(function(topic) {
    return req({
      hostname: "learn.microsoft.com",
      path: "/api/search?search=" + encodeURIComponent(topic) + "&locale=en-us&$top=4",
      method: "GET",
      headers: { Accept: "application/json" }
    }).then(function(r) {
      return { topic: topic, results: r.body.results || [] };
    }).catch(function() { return { topic: topic, results: [] }; });
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

// ════════════════════════════════════════════════════════════
// SECTION 4 — Dell Support Web Search → FAQs
// ════════════════════════════════════════════════════════════
function refreshDellSupport() {
  log("[Dell] Searching for Dell hardware updates...");
  return Promise.all(DELL_SEARCHES.map(function(query) {
    return req({
      hostname: "html.duckduckgo.com",
      path: "/html/?q=site:dell.com+" + encodeURIComponent(query),
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" }
    }).then(function(r) {
      var text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
      var snippets = [];
      var titleRx = /class="result__a"[^>]*>([^<]{5,120})/g;
      var urlRx = /class="result__url"[^>]*>([^<]{5,120})/g;
      var titles = [], urls = [];
      var m;
      while ((m = titleRx.exec(text)) !== null && titles.length < 4) titles.push(m[1].trim());
      while ((m = urlRx.exec(text)) !== null && urls.length < 4) urls.push(m[1].trim());
      return { query: query, titles: titles, urls: urls };
    }).catch(function() { return { query: query, titles: [], urls: [] }; });
  })).then(function(results) {
    var md = "# Dell Support — Hardware Updates & Drivers\n\n";
    md += "_Last updated: " + today() + "_\n\n";
    md += "Auto-refreshed nightly. Links to Dell support resources for OptiPlex, Latitude, and PowerEdge hardware.\n\n";
    md += "> **Tip:** Always use your Service Tag at [support.dell.com](https://support.dell.com) for device-specific drivers.\n\n";

    results.forEach(function(r) {
      if (!r.titles.length) return;
      md += "## " + r.query + "\n\n";
      r.titles.forEach(function(title, i) {
        var url = r.urls[i] ? "https://" + r.urls[i].replace(/^https?:\/\//, "") : null;
        if (url) {
          md += "- [" + title + "](" + url + ")\n";
        } else {
          md += "- " + title + "\n";
        }
      });
      md += "\n";
    });

    md += "---\n\n## Key Dell Support Links\n\n";
    md += "- [Dell Support Home](https://support.dell.com)\n";
    md += "- [Driver & Downloads](https://www.dell.com/support/home/en-us?app=drivers)\n";
    md += "- [Warranty Lookup](https://www.dell.com/support/home/en-us?app=warranty)\n";
    md += "- [Manuals & Documentation](https://www.dell.com/support/home/en-us?app=manuals)\n";
    md += "- [Product Advisories](https://www.dell.com/support/home/en-us?app=productalerts)\n";

    // Fetch live content from top Dell result URLs
    var dellFetchJobs = [];
    results.forEach(function(r) {
      if (r.urls && r.urls[0]) {
        var url = r.urls[0].startsWith("http") ? r.urls[0] : "https://" + r.urls[0];
        if (url.includes("dell.com")) {
          dellFetchJobs.push(
            fetchPageText(url, 2500).then(function(text) {
              r.liveContent = text;
              r.liveUrl = url;
            }).catch(function() {})
          );
        }
      }
    });
    return Promise.all(dellFetchJobs).then(function() {
      results.forEach(function(r) {
        if (r.liveContent) {
          md += "### Live content from Dell.com — " + r.query + "\n\n";
          md += "_Source: " + r.liveUrl + "_\n\n";
          md += r.liveContent + "\n\n---\n\n";
        }
      });
      log("[Dell] Updated Dell support resources with live content for " + dellFetchJobs.length + " pages");
      return uploadToKB("FAQs", "dell-support-updates.md", md);
    });
  }).catch(function(e) { log("[Dell] Error: " + e.message); });
}

// ════════════════════════════════════════════════════════════
// SECTION 5 — HP Security Advisories + Support → Troubleshooting
// ════════════════════════════════════════════════════════════
function refreshHPSupport() {
  log("[HP] Fetching HP security advisories and support content...");

  // Web search for HP updates
  var searchJobs = HP_SEARCHES.map(function(query) {
    return req({
      hostname: "html.duckduckgo.com",
      path: "/html/?q=site:support.hp.com+" + encodeURIComponent(query),
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" }
    }).then(function(r) {
      var text = typeof r.body === "string" ? r.body : "";
      var titles = [], urls = [];
      var tRx = /class="result__a"[^>]*>([^<]{5,120})/g;
      var uRx = /class="result__url"[^>]*>([^<]{5,120})/g;
      var m;
      while ((m = tRx.exec(text)) !== null && titles.length < 4) titles.push(m[1].trim());
      while ((m = uRx.exec(text)) !== null && urls.length < 4) urls.push(m[1].trim());
      return { query: query, titles: titles, urls: urls };
    }).catch(function() { return { query: query, titles: [], urls: [] }; });
  });

  // Fetch HP support pages directly
  var pageFetches = HP_SUPPORT_URLS.map(function(url) {
    return fetchPageText(url, 2500).then(function(text) {
      return { url: url, content: text };
    }).catch(function() { return { url: url, content: "" }; });
  });

  return Promise.all([Promise.all(searchJobs), Promise.all(pageFetches)]).then(function(all) {
    var searchResults = all[0], pageResults = all[1];

    var md = "# HP Support — Printers, Computers & Scanners\n\n";
    md += "_Last updated: " + today() + "_\n\n";
    md += "Auto-refreshed nightly from HP Support. Covers LaserJet/OfficeJet printers, EliteBook/ProBook computers, and ScanJet scanners.\n\n";
    md += "> **Tip:** Always use your HP Serial Number or Product Number at [support.hp.com](https://support.hp.com) for device-specific drivers and advisories.\n\n";

    // Search results
    md += "## Latest HP Support Articles\n\n";
    searchResults.forEach(function(r) {
      if (!r.titles.length) return;
      md += "### " + r.query + "\n\n";
      r.titles.forEach(function(title, i) {
        var url = r.urls[i] ? "https://" + r.urls[i].replace(/^https?:\/\//, "") : null;
        md += url ? "- [" + title + "](" + url + ")\n" : "- " + title + "\n";
      });
      md += "\n";
    });

    // Live page content
    md += "## Live Content from HP Support\n\n";
    pageResults.forEach(function(p) {
      if (!p.content) return;
      md += "### Source: " + p.url + "\n\n";
      md += p.content.substring(0, 2000) + "\n\n---\n\n";
    });

    // Key links
    md += "## Key HP Support Links\n\n";
    md += "- [HP Support Home](https://support.hp.com)\n";
    md += "- [HP Security Advisories](https://support.hp.com/us-en/security-advisories)\n";
    md += "- [HP Printer Drivers](https://support.hp.com/us-en/products/printers)\n";
    md += "- [HP Computer Drivers](https://support.hp.com/us-en/products/desktops-workstations)\n";
    md += "- [HP Scanner Support](https://support.hp.com/us-en/products/scanners)\n";
    md += "- [HP Warranty Check](https://support.hp.com/us-en/checkwarranty)\n";
    md += "- [HP Parts Store](https://parts.hp.com)\n\n";

    log("[HP] Updated HP support resources");
    return uploadToKB("Troubleshooting", "hp-support-updates.md", md);
  }).catch(function(e) { log("[HP] Error: " + e.message); });
}

// ════════════════════════════════════════════════════════════
// SECTION 6 — Fujitsu Scanner Support → Troubleshooting
// ════════════════════════════════════════════════════════════
function refreshFujitsuSupport() {
  log("[Fujitsu] Fetching Fujitsu scanner support content...");

  var searchJobs = FUJITSU_SEARCHES.map(function(query) {
    return req({
      hostname: "html.duckduckgo.com",
      path: "/html/?q=" + encodeURIComponent(query + " site:fujitsu.com OR site:pfu.fujitsu.com OR site:scansnap.fujitsu.com"),
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" }
    }).then(function(r) {
      var text = typeof r.body === "string" ? r.body : "";
      var titles = [], urls = [];
      var tRx = /class="result__a"[^>]*>([^<]{5,120})/g;
      var uRx = /class="result__url"[^>]*>([^<]{5,120})/g;
      var m;
      while ((m = tRx.exec(text)) !== null && titles.length < 4) titles.push(m[1].trim());
      while ((m = uRx.exec(text)) !== null && urls.length < 4) urls.push(m[1].trim());
      return { query: query, titles: titles, urls: urls };
    }).catch(function() { return { query: query, titles: [], urls: [] }; });
  });

  var pageFetches = FUJITSU_SUPPORT_URLS.map(function(url) {
    return fetchPageText(url, 2500).then(function(text) {
      return { url: url, content: text };
    }).catch(function() { return { url: url, content: "" }; });
  });

  return Promise.all([Promise.all(searchJobs), Promise.all(pageFetches)]).then(function(all) {
    var searchResults = all[0], pageResults = all[1];

    var md = "# Fujitsu Scanner Support — ScanSnap & fi Series\n\n";
    md += "_Last updated: " + today() + "_\n\n";
    md += "Auto-refreshed nightly. Covers Fujitsu ScanSnap (iX, S, SP series) and fi-series production scanners.\n\n";
    md += "> **Tip:** Identify your scanner model number on the label (bottom or back of unit) before searching for drivers.\n\n";

    md += "## Latest Fujitsu Support Articles\n\n";
    searchResults.forEach(function(r) {
      if (!r.titles.length) return;
      md += "### " + r.query + "\n\n";
      r.titles.forEach(function(title, i) {
        var url = r.urls[i] ? "https://" + r.urls[i].replace(/^https?:\/\//, "") : null;
        md += url ? "- [" + title + "](" + url + ")\n" : "- " + title + "\n";
      });
      md += "\n";
    });

    md += "## Live Content from Fujitsu Support\n\n";
    pageResults.forEach(function(p) {
      if (!p.content) return;
      md += "### Source: " + p.url + "\n\n";
      md += p.content.substring(0, 2000) + "\n\n---\n\n";
    });

    md += "## Key Fujitsu Support Links\n\n";
    md += "- [ScanSnap Support](https://scansnap.fujitsu.com/global/support/)\n";
    md += "- [fi Series Support](https://www.pfu.fujitsu.com/en/scanners/support/)\n";
    md += "- [ScanSnap Driver Downloads](https://scansnap.fujitsu.com/global/dl/)\n";
    md += "- [fi Series Driver Downloads](https://www.pfu.fujitsu.com/en/scanners/fi/downloads/)\n";
    md += "- [Fujitsu Scanner Setup Guide](https://www.pfu.fujitsu.com/en/scanners/support/setup/)\n";
    md += "- [Online Scanner Registration](https://scansnap.fujitsu.com/global/register/)\n\n";

    log("[Fujitsu] Updated Fujitsu scanner support resources");
    return uploadToKB("Troubleshooting", "fujitsu-scanner-support.md", md);
  }).catch(function(e) { log("[Fujitsu] Error: " + e.message); });
}

// ════════════════════════════════════════════════════════════
// MAIN — Run all refresh jobs
// ════════════════════════════════════════════════════════════
async function main() {
  log("═══════════════════════════════════════════");
  log("IT KB Nightly Refresh — " + new Date().toISOString());
  log("═══════════════════════════════════════════");

  try {
    await refreshCiscoAdvisories();
    await refreshMSServiceHealth();
    await refreshMSLearnDocs();
    await refreshDellSupport();
    await refreshHPSupport();
    await refreshFujitsuSupport();

    log("═══════════════════════════════════════════");
    log("Refresh complete — all libraries updated.");
    log("═══════════════════════════════════════════");
  } catch (e) {
    log("FATAL ERROR: " + e.message);
    process.exit(1);
  }
}

main();
