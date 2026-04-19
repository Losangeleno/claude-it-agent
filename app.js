/**
 * app.js — Claude IT Agent (Remote MCP Server)
 * Runs on Azure App Service. Exposes all IT Agent tools over
 * MCP SSE transport so Claude web, desktop, and mobile can connect.
 *
 * Endpoints:
 *   GET  /sse      — MCP SSE connection (Claude connects here)
 *   POST /message  — MCP message handler
 *   GET  /health   — Health check (Azure App Service probe)
 *   POST /query    — Legacy REST API (backward compat)
 */

"use strict";

const https  = require("https");
const http   = require("http");
const crypto = require("crypto");

// ── Config ────────────────────────────────────────────────────────────────────
const PORT            = process.env.PORT || 3000;
const TENANT_ID       = "e876d5db-a9f8-4e71-abc1-dcee4d8b0578";
const CLIENT_ID       = "50d28fcf-1e66-452f-be81-36b40b640605";
const CLIENT_SECRET   = "OCy8Q~qnTAqtSfK.8bIdnKVqcCv46zMFGkIhQbtc";
const GRAPH_CLIENT_ID = "9c823e8e-5ce1-480c-8240-e19f6b23512e";
const GRAPH_CLIENT_SECRET = "pMN8Q~7qNKr6pjEc4j9FLTHBA74rH.CwjwnjmbAg";
const TENANT_NAME     = "ClaudeITAgent";
const SITE_NAME       = "ITKnowledgeBase";
const CISCO_KEY       = "qtbj2x2knjbmewmnt3kss8hy";
const CISCO_SECRET    = "g7MRPgWGBPdaKcAQTuxDGqBB";
const SENDER_EMAIL    = "manueltucker@claudeitagent.onmicrosoft.com";
const TEAMS_WEBHOOK_URL = "https://claudeitagent.webhook.office.com/webhookb2/1dede829-35a4-4d2b-96d4-ab4687aa13a5@e876d5db-a9f8-4e71-abc1-dcee4d8b0578/IncomingWebhook/a5405b78e76940f1b4175bfac7486426/11d7d5c6-f55b-47ef-85e8-f9d17941e2a1/V2Wba6PgaYn13xB5CHkZ8cZsICUrVnSI-PhIA1U2qADrk1";
const TEAMS_TEAM_ID   = "1dede829-35a4-4d2b-96d4-ab4687aa13a5";
const TEAMS_CHANNEL_ID = "19:h3O1iQ3KfOuqLoQKUtbWEa2lLMqHBwjX1qTlTK0lrqw1@thread.tacv2";

// API key — Claude sessions must send this as Bearer token
// Change this to something secret before deploying
const API_KEY = process.env.MCP_API_KEY || "claudeITAgent2026";

// ── Vendor support site configuration ────────────────────────────────────────
const VENDOR_SITES = {
  cisco:     { domain: "cisco.com",              searchPath: "/c/en/us/search/index.html?query=", label: "Cisco Support" },
  dell:      { domain: "dell.com",               searchPath: "/support/home/search?query=",       label: "Dell Support" },
  hp:        { domain: "support.hp.com",         searchPath: "/us-en/search#q=",                 label: "HP Support" },
  hpe:       { domain: "support.hpe.com",        searchPath: "/hpesc/public/api/document/",      label: "HPE Support" },
  fujitsu:   { domain: "support.fujitsu.com",    searchPath: "/sp/support/",                     label: "Fujitsu Support" },
  apple:     { domain: "support.apple.com",      searchPath: "/",                                label: "Apple Support" },
  logitech:  { domain: "support.logi.com",       searchPath: "/hc/en-us/search?utf8=%E2%9C%93&query=", label: "Logitech Support" },
  microsoft: { domain: "support.microsoft.com",  searchPath: "/en-us/search?query=",             label: "Microsoft Support" }
};

// Vendor-specific DDG search (site-scoped) → parse top URLs → fetch content
function searchVendorDocs(vendor, query, maxResults) {
  maxResults = maxResults || 3;
  var site = VENDOR_SITES[vendor.toLowerCase()];
  var searchDomain = site ? site.domain : vendor.toLowerCase() + ".com";
  var supportPaths = {
    cisco:   "/c/en/us/support",
    dell:    "/support",
    hp:      "/us-en",
    hpe:     "/hpesc/public",
    fujitsu: "/sp/support"
  };
  var pathFilter = supportPaths[vendor.toLowerCase()] || "/support";
  var ddgQuery = "site:" + searchDomain + pathFilter + " " + query;
  return new Promise(function(resolve) {
    var ddgPath = "/html/?q=" + encodeURIComponent(ddgQuery);
    var r = https.get({
      hostname: "html.duckduckgo.com",
      path: ddgPath,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" }
    }, function(res) {
      var data = "";
      res.on("data", function(c) { data += c; });
      res.on("end", function() {
        // Extract result URLs and titles from DDG HTML
        var urls = [];
        var urlRx = /class="result__url"[^>]*>([^<]+)</g;
        var titleRx = /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)</g;
        var matches = [], m;
        while ((m = titleRx.exec(data)) !== null && matches.length < maxResults) {
          var href = m[1];
          var title = m[2].trim();
          // DDG wraps URLs — extract the actual URL
          try {
            var uddg = new URL("https://duckduckgo.com" + href);
            var actual = uddg.searchParams.get("uddg") || uddg.searchParams.get("u") || href;
            if (actual.startsWith("http") && actual.includes(searchDomain)) {
              matches.push({ url: actual, title: title });
            }
          } catch(e) {}
        }
        // Fallback: grab raw hrefs containing the domain
        if (!matches.length) {
          var rawRx = new RegExp('href="(https?:\\/\\/[^"]*' + searchDomain.replace(/\./g, '\\.') + '[^"]*)"', 'g');
          while ((m = rawRx.exec(data)) !== null && matches.length < maxResults) {
            matches.push({ url: m[1], title: vendor + " support article" });
          }
        }
        resolve(matches);
      });
    });
    r.on("error", function() { resolve([]); });
    r.setTimeout(12000, function() { r.destroy(); resolve([]); });
  });
}

// Pull vendor support articles for a topic and upload to KB
function syncVendorDocsToKB(vendor, topic, library, maxArticles) {
  maxArticles = maxArticles || 3;
  var LIBRARY_DRIVES = {
    "faqs":            "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-0YkaK7sToQb9UfBCD0V8l",
    "troubleshooting": "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-s9M-vo64gR6RqcavYF4co",
    "runbooks":        "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d8ntgJz28NVQ5IBUqynE4Gk",
    "assets":          "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9OV5yeNjEWSZzs4VJ2fbAB",
    "cabling":         "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9lg9HgzNLwT7cu7swCUvqF"
  };
  var lib = (library || "troubleshooting").toLowerCase();
  var driveId = LIBRARY_DRIVES[lib] || LIBRARY_DRIVES["troubleshooting"];
  var vendorLabel = (VENDOR_SITES[vendor.toLowerCase()] || {}).label || vendor;

  return searchVendorDocs(vendor, topic, maxArticles).then(function(articles) {
    if (!articles.length) return { vendor: vendor, uploaded: 0, skipped: 0, articles: [] };
    var uploaded = 0, skipped = 0, articleList = [];
    return articles.reduce(function(chain, item) {
      return chain.then(function() {
        return fetchPageText(item.url, 6000).then(function(content) {
          if (!content || content.length < 100) { skipped++; return; }
          var slug = (item.title || topic).replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-").toLowerCase().substring(0, 55);
          var filename = vendor.toLowerCase() + "-" + slug + ".md";
          var markdown = "# " + (item.title || topic) + "\n\n"
            + "> **Vendor:** " + vendorLabel + "\n"
            + "> **Source:** " + item.url + "\n"
            + "> **Synced:** " + new Date().toISOString().split("T")[0] + "\n\n"
            + content.replace(/\s{3,}/g, "\n\n").trim();
          var fileData = Buffer.from(markdown, "utf8");
          return getSPToken().then(function(t) {
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
          }).then(function(status) {
            if (status === 200 || status === 201) {
              uploaded++;
              articleList.push({ title: item.title, file: filename, library: lib });
            } else { skipped++; }
          }).catch(function() { skipped++; });
        }).catch(function() { skipped++; });
      });
    }, Promise.resolve()).then(function() {
      return { vendor: vendor, uploaded: uploaded, skipped: skipped, library: lib, articles: articleList };
    });
  });
}

// ── Microsoft Learn topic → KB library mapping ────────────────────────────────
const LEARN_LIBRARY_MAP = {
  "windows": "Troubleshooting",
  "azure": "Troubleshooting",
  "entra": "Troubleshooting",
  "intune": "Runbooks",
  "teams": "Troubleshooting",
  "outlook": "Troubleshooting",
  "exchange": "Troubleshooting",
  "onedrive": "Troubleshooting",
  "sharepoint": "Troubleshooting",
  "bitlocker": "Runbooks",
  "vpn": "Troubleshooting",
  "dns": "Troubleshooting",
  "active directory": "Runbooks",
  "default": "Troubleshooting"
};

function inferLibrary(topic) {
  var t = (topic || "").toLowerCase();
  for (var key of Object.keys(LEARN_LIBRARY_MAP)) {
    if (key !== "default" && t.includes(key)) return LEARN_LIBRARY_MAP[key];
  }
  return LEARN_LIBRARY_MAP["default"];
}

// ── Fetch and convert a Microsoft Learn article to markdown ──────────────────
function fetchLearnArticle(url) {
  return fetchPageText(url, 6000).then(function(text) {
    if (!text || text.length < 100) return null;
    // Clean up whitespace artifacts from HTML strip
    return text.replace(/\s{3,}/g, "\n\n").trim();
  });
}

// ── Pull top Learn articles for a topic and upload to KB ─────────────────────
function syncLearnTopicToKB(topic, library, maxArticles) {
  maxArticles = maxArticles || 3;
  return req({
    hostname: "learn.microsoft.com",
    path: "/api/search?search=" + encodeURIComponent(topic) + "&locale=en-us&$top=" + maxArticles + "&facet=category&$filter=category%20eq%20%27Documentation%27",
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
  }).then(function(r) {
    var results = (r.body.results || []).slice(0, maxArticles);
    if (!results.length) return { uploaded: 0, skipped: 0, articles: [] };
    var lib = library || inferLibrary(topic);
    var LIBRARY_DRIVES = {
      "faqs":             "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-0YkaK7sToQb9UfBCD0V8l",
      "troubleshooting":  "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-s9M-vo64gR6RqcavYF4co",
      "runbooks":         "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d8ntgJz28NVQ5IBUqynE4Gk",
      "assets":           "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9OV5yeNjEWSZzs4VJ2fbAB",
      "cabling":          "b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9lg9HgzNLwT7cu7swCUvqF"
    };
    var driveId = LIBRARY_DRIVES[lib.toLowerCase()];
    if (!driveId) driveId = LIBRARY_DRIVES["troubleshooting"];
    var uploaded = 0, skipped = 0, articleList = [];
    return results.reduce(function(chain, item) {
      return chain.then(function() {
        var articleUrl = item.url;
        if (!articleUrl || !articleUrl.startsWith("https://learn.microsoft.com")) {
          skipped++;
          return;
        }
        return fetchLearnArticle(articleUrl).then(function(content) {
          if (!content) { skipped++; return; }
          var slug = (item.title || topic).replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-").toLowerCase().substring(0, 60);
          var filename = "learn-" + slug + ".md";
          var markdown = "# " + (item.title || topic) + "\n\n";
          markdown += "> Source: " + articleUrl + "\n";
          markdown += "> Synced: " + new Date().toISOString().split("T")[0] + "\n\n";
          markdown += content;
          var fileData = Buffer.from(markdown, "utf8");
          return getSPToken().then(function(t) {
            return new Promise(function(resolve, reject) {
              var r = https.request({
                hostname: "graph.microsoft.com",
                path: "/v1.0/drives/" + driveId + "/root:/" + encodeURIComponent(filename) + ":/content",
                method: "PUT",
                headers: { Authorization: "Bearer " + t, "Content-Type": "text/plain; charset=utf-8", "Content-Length": fileData.length }
              }, function(re) {
                var d = ""; re.on("data", function(c) { d += c; }); re.on("end", function() { resolve(re.statusCode); });
              });
              r.on("error", reject); r.write(fileData); r.end();
            });
          }).then(function(status) {
            if (status === 200 || status === 201) {
              uploaded++;
              articleList.push({ title: item.title, file: filename, library: lib });
            } else { skipped++; }
          }).catch(function() { skipped++; });
        }).catch(function() { skipped++; });
      });
    }, Promise.resolve()).then(function() {
      return { uploaded: uploaded, skipped: skipped, library: lib, articles: articleList };
    });
  });
}

// ── Token caches ──────────────────────────────────────────────────────────────
let spToken=null,spExpiry=0,graphToken=null,graphExpiry=0;
let ciscoToken=null,ciscoExpiry=0,siteId=null,cachedDrives=[];

// ── SSE sessions ──────────────────────────────────────────────────────────────
const sessions = new Map(); // sessionId → res (SSE response object)

// ── Core HTTP helper ──────────────────────────────────────────────────────────
function req(o,b){return new Promise(function(res,rej){var r=https.request(o,function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{res({status:re.statusCode,body:JSON.parse(d)});}catch(e){res({status:re.statusCode,body:d});}});});r.on("error",rej);if(b)r.write(b);r.end();});}

// ── Token functions ───────────────────────────────────────────────────────────
function getSPToken(){if(spToken&&Date.now()<spExpiry)return Promise.resolve(spToken);var b="grant_type=client_credentials&client_id="+encodeURIComponent(CLIENT_ID)+"&client_secret="+encodeURIComponent(CLIENT_SECRET)+"&scope="+encodeURIComponent("https://graph.microsoft.com/.default");return req({hostname:"login.microsoftonline.com",path:"/"+TENANT_ID+"/oauth2/v2.0/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(b)}},b).then(function(r){spToken=r.body.access_token;spExpiry=Date.now()+(r.body.expires_in-60)*1000;return spToken;});}

function getGraphToken(){if(graphToken&&Date.now()<graphExpiry)return Promise.resolve(graphToken);var b="grant_type=client_credentials&client_id="+encodeURIComponent(GRAPH_CLIENT_ID)+"&client_secret="+encodeURIComponent(GRAPH_CLIENT_SECRET)+"&scope="+encodeURIComponent("https://graph.microsoft.com/.default");return req({hostname:"login.microsoftonline.com",path:"/"+TENANT_ID+"/oauth2/v2.0/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(b)}},b).then(function(r){graphToken=r.body.access_token;graphExpiry=Date.now()+(r.body.expires_in-60)*1000;return graphToken;});}

function getCiscoToken(){if(ciscoToken&&Date.now()<ciscoExpiry)return Promise.resolve(ciscoToken);var b="grant_type=client_credentials&client_id="+encodeURIComponent(CISCO_KEY)+"&client_secret="+encodeURIComponent(CISCO_SECRET);return req({hostname:"id.cisco.com",path:"/oauth2/default/v1/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(b)}},b).then(function(r){ciscoToken=r.body.access_token;ciscoExpiry=Date.now()+3500000;return ciscoToken;});}

// ── Graph helpers ─────────────────────────────────────────────────────────────
function graph(path){return getSPToken().then(function(t){return req({hostname:"graph.microsoft.com",path:"/v1.0"+path,method:"GET",headers:{Authorization:"Bearer "+t}});}).then(function(r){return r.body;});}

function graphGet(path){return getGraphToken().then(function(t){return req({hostname:"graph.microsoft.com",path:"/v1.0"+path,method:"GET",headers:{Authorization:"Bearer "+t}});}).then(function(r){return r.body;});}

function graphPost(path,body){var b=JSON.stringify(body);return getGraphToken().then(function(t){return req({hostname:"graph.microsoft.com",path:"/v1.0"+path,method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)}},b);}).then(function(r){return r.body;});}

function graphSearch(path,params){return getGraphToken().then(function(t){var qs=Object.entries(params||{}).map(function(e){return encodeURIComponent(e[0])+"="+encodeURIComponent(e[1]);}).join("&");return req({hostname:"graph.microsoft.com",path:"/v1.0"+path+(qs?"?"+qs:""),method:"GET",headers:{Authorization:"Bearer "+t,ConsistencyLevel:"eventual"}});}).then(function(r){return r.body;});}

function getSiteId(){if(siteId)return Promise.resolve(siteId);return graph("/sites/"+TENANT_NAME+".sharepoint.com:/sites/"+SITE_NAME+":").then(function(d){siteId=d.id;return siteId;});}

function getDrives(){if(cachedDrives.length)return Promise.resolve(cachedDrives);return getSiteId().then(function(id){return graph("/sites/"+id+"/drives");}).then(function(d){cachedDrives=d.value||[];return cachedDrives;});}

function fetchPageText(urlString,maxLen){maxLen=maxLen||2500;return new Promise(function(resolve){try{var u=new URL(urlString);if(u.protocol!=="https:"){resolve("");return;}var r=https.get({hostname:u.hostname,path:u.pathname+u.search,headers:{"User-Agent":"Mozilla/5.0","Accept":"text/html"}},function(res){if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){resolve(fetchPageText(res.headers.location,maxLen));return;}var data="";res.on("data",function(c){data+=c;if(data.length>150000)res.destroy();});res.on("end",function(){var text=data.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s{2,}/g," ").trim();resolve(text.substring(0,maxLen));});});r.on("error",function(){resolve("");});r.setTimeout(12000,function(){r.destroy();resolve("");});}catch(e){resolve("");}});}

// ── Tools definition ──────────────────────────────────────────────────────────
const TOOLS = [
  {name:"search_kb",description:"Search IT Knowledge Base for scripts, runbooks, FAQs, assets, cabling, or troubleshooting guides",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}},
  {name:"list_library",description:"List files in a library: Scripts, Runbooks, FAQs, Assets, Cabling, or Troubleshooting",inputSchema:{type:"object",properties:{library:{type:"string"}},required:["library"]}},
  {name:"read_file",description:"Read contents of a file from the knowledge base",inputSchema:{type:"object",properties:{drive_id:{type:"string"},item_id:{type:"string"}},required:["drive_id","item_id"]}},
  {name:"ms_service_health",description:"Check live Microsoft 365 service health and active outages",inputSchema:{type:"object",properties:{service:{type:"string"}}}},
  {name:"ms_maintenance",description:"Get upcoming Microsoft 365 planned maintenance",inputSchema:{type:"object",properties:{}}},
  {name:"cisco_advisories",description:"Search Cisco PSIRT security advisories by product",inputSchema:{type:"object",properties:{product:{type:"string"}},required:["product"]}},
  {name:"cisco_cve",description:"Look up a specific CVE in Cisco advisories",inputSchema:{type:"object",properties:{cve:{type:"string"}},required:["cve"]}},
  {name:"search_microsoft_learn",description:"Search Microsoft Learn documentation",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}},
  {name:"web_search",description:"Search the web for IT information",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}},
  {name:"send_email",description:"Send an email from the IT agent",inputSchema:{type:"object",properties:{to:{type:"string"},subject:{type:"string"},body:{type:"string"},is_html:{type:"boolean"}},required:["to","subject","body"]}},
  {name:"upload_to_kb",description:"Upload a markdown file to the IT Knowledge Base",inputSchema:{type:"object",properties:{library:{type:"string"},filename:{type:"string"},content:{type:"string"}},required:["library","filename","content"]}},
  {name:"build_scenario",description:"Build a structured field troubleshooting scenario from a problem description",inputSchema:{type:"object",properties:{problem:{type:"string"}},required:["problem"]}},
  // Phase 2 — Azure AD
  {name:"get_user",description:"Get an Azure AD user profile by email or object ID",inputSchema:{type:"object",properties:{user_id:{type:"string"}},required:["user_id"]}},
  {name:"search_users",description:"Search Azure AD users by name or email",inputSchema:{type:"object",properties:{query:{type:"string"},limit:{type:"number"}},required:["query"]}},
  {name:"get_user_groups",description:"Get all group memberships for an Azure AD user",inputSchema:{type:"object",properties:{user_id:{type:"string"}},required:["user_id"]}},
  {name:"list_devices",description:"List Azure AD / Intune-registered devices",inputSchema:{type:"object",properties:{filter:{type:"string"}}}},
  {name:"get_sign_in_logs",description:"Get recent Azure AD sign-in logs for a user",inputSchema:{type:"object",properties:{user_id:{type:"string"},limit:{type:"number"}}}},
  // Phase 1 — Teams
  {name:"list_teams",description:"List all Microsoft Teams in the organisation",inputSchema:{type:"object",properties:{}}},
  {name:"list_channels",description:"List all channels in a Microsoft Team",inputSchema:{type:"object",properties:{team_id:{type:"string"}},required:["team_id"]}},
  {name:"get_channel_messages",description:"Read recent messages from a Teams channel",inputSchema:{type:"object",properties:{team_id:{type:"string"},channel_id:{type:"string"},limit:{type:"number"}},required:["team_id","channel_id"]}},
  {name:"send_channel_message",description:"Post a message to the IT Agent Teams channel",inputSchema:{type:"object",properties:{message:{type:"string"},html:{type:"boolean"}},required:["message"]}},
  // Phase 3 — Microsoft Learn sync
  {name:"sync_learn_to_kb",description:"Search Microsoft Learn for a topic and save the top articles to the IT Knowledge Base. Automatically picks the right library (Troubleshooting, Runbooks, FAQs).",inputSchema:{type:"object",properties:{topic:{type:"string",description:"The IT topic to search, e.g. 'Windows 11 Event Viewer', 'BitLocker recovery', 'Intune device enrollment'"},library:{type:"string",description:"Override target library: Troubleshooting, Runbooks, FAQs, Assets, Cabling. Leave blank for auto-detect."},max_articles:{type:"number",description:"Number of articles to sync (1-5, default 3)"}},required:["topic"]}},
  {name:"sync_vendor_docs",description:"Pull support documentation from Cisco, Dell, HP/HPE, Fujitsu, or Apple and save to the IT Knowledge Base.",inputSchema:{type:"object",properties:{vendor:{type:"string",enum:["cisco","dell","hp","hpe","fujitsu","apple"],description:"The vendor to search"},topic:{type:"string",description:"The support topic"},library:{type:"string",description:"Target KB library: Troubleshooting, Runbooks, FAQs. Default: Troubleshooting"},max_articles:{type:"number",description:"Number of articles to pull (1-5, default 3)"}},required:["vendor","topic"]}},
  // Phase 4 — Intune / Device Management
  {name:"get_intune_devices",description:"List all devices enrolled in Microsoft Intune. Filter by platform (windows, ios, macos, android), user, or compliance state.",inputSchema:{type:"object",properties:{platform:{type:"string",description:"Filter by OS: windows, ios, macos, android. Leave blank for all."},user:{type:"string",description:"Filter by user email or display name"},compliance:{type:"string",enum:["compliant","noncompliant","unknown","all"],description:"Filter by compliance state. Default: all"},limit:{type:"number",description:"Max results (default 25, max 100)"}}}},
  {name:"get_intune_device",description:"Get full details for a specific Intune-managed device by device name, serial number, or device ID.",inputSchema:{type:"object",properties:{device:{type:"string",description:"Device name, serial number, or Intune device ID"}},required:["device"]}},
  {name:"get_noncompliant_devices",description:"List all non-compliant devices in Intune with the reason they are out of compliance. Use to identify devices that need attention.",inputSchema:{type:"object",properties:{platform:{type:"string",description:"Filter by OS: windows, ios, macos, android. Leave blank for all."}}}},
  {name:"get_device_compliance",description:"Get the compliance status and policy details for a specific user or device.",inputSchema:{type:"object",properties:{user:{type:"string",description:"User email or UPN to check all their devices"},device:{type:"string",description:"Device name or ID to check a specific device"}}}},
  {name:"sync_intune_device",description:"Trigger an immediate Intune sync on a device to push latest policies and check compliance.",inputSchema:{type:"object",properties:{device_id:{type:"string",description:"Intune device ID (get from get_intune_device)"}},required:["device_id"]}},
  {name:"get_intune_apps",description:"List apps deployed through Intune and their installation status across devices.",inputSchema:{type:"object",properties:{app_name:{type:"string",description:"Filter by app name (partial match)"},limit:{type:"number",description:"Max results (default 20)"}}}},
  {name:"create_list_workflow",description:"Create an interactive IT workflow checklist in Microsoft Lists. Field tech can tick off steps on mobile via Teams Lists tab.",inputSchema:{type:"object",properties:{title:{type:"string"},task_type:{type:"string"},tech_name:{type:"string"},site:{type:"string"},steps:{type:"array",items:{type:"string"}}},required:["title","task_type"]}}
];

// ── Tool handlers ─────────────────────────────────────────────────────────────
function handleTool(name, args) {
  // KB tools
  if(name==="search_kb"){var KB_PATH="https://"+TENANT_NAME.toLowerCase()+".sharepoint.com/sites/"+SITE_NAME;var sbody={requests:[{entityTypes:["driveItem"],query:{queryString:args.query+" path:\""+KB_PATH+"\""},from:0,size:25}]};return graphPost("/search/query",sbody).then(function(d){var hits=((((d.value||[])[0]||{}).hitsContainers||[])[0]||{}).hits||[];var r=hits.slice(0,8).map(function(h){var res=h.resource||{};var pr=res.parentReference||{};return{name:res.name,id:res.id,driveId:pr.driveId,library:pr.name,webUrl:res.webUrl};});return{content:[{type:"text",text:r.length?JSON.stringify(r,null,2):"No results for: "+args.query}]};}).catch(function(e){return{content:[{type:"text",text:"search_kb error: "+e.message}]};});}
  if(name==="sync_learn_to_kb"){return syncLearnTopicToKB(args.topic,args.library,args.max_articles||3).then(function(r){var msg=r.uploaded>0?"Synced "+r.uploaded+" article(s) to "+r.library+":\n"+r.articles.map(function(a){return"• "+a.title+" ("+a.file+")";}).join("\n"):"Nothing uploaded. Skipped: "+r.skipped+" (no content or upload error).";return{content:[{type:"text",text:msg}]};}).catch(function(e){return{content:[{type:"text",text:"sync_learn_to_kb error: "+e.message}]};});}
  // Intune / Device Management tools
  if(name==="get_intune_devices"){
    var path="/deviceManagement/managedDevices?$top="+(args.limit||25)+"&$select=id,deviceName,operatingSystem,osVersion,complianceState,userDisplayName,userPrincipalName,serialNumber,lastSyncDateTime,managedDeviceOwnerType,enrolledDateTime,model,manufacturer,emailAddress";
    var filters=[];
    if(args.platform)filters.push("operatingSystem eq '"+args.platform+"'");
    if(args.compliance&&args.compliance!=="all")filters.push("complianceState eq '"+args.compliance+"'");
    if(filters.length)path+="&$filter="+encodeURIComponent(filters.join(" and "));
    return graphGet(path).then(function(d){
      var devices=(d.value||[]);
      if(args.user){var u=args.user.toLowerCase();devices=devices.filter(function(dev){return(dev.userDisplayName||"").toLowerCase().includes(u)||(dev.userPrincipalName||"").toLowerCase().includes(u);});}
      if(!devices.length)return{content:[{type:"text",text:"No devices found matching the criteria."}]};
      var summary=devices.map(function(dev){return{name:dev.deviceName,user:dev.userDisplayName,email:dev.userPrincipalName,os:dev.operatingSystem+" "+dev.osVersion,compliance:dev.complianceState,serial:dev.serialNumber,model:dev.manufacturer+" "+dev.model,lastSync:dev.lastSyncDateTime,enrolled:dev.enrolledDateTime};});
      return{content:[{type:"text",text:"Found "+devices.length+" device(s):\n\n"+JSON.stringify(summary,null,2)}]};
    }).catch(function(e){return{content:[{type:"text",text:"get_intune_devices error: "+e.message}]};});
  }
  if(name==="get_intune_device"){
    var searchTerm=args.device;
    return graphGet("/deviceManagement/managedDevices?$top=100&$select=id,deviceName,operatingSystem,osVersion,complianceState,userDisplayName,userPrincipalName,serialNumber,lastSyncDateTime,model,manufacturer,emailAddress,imei,wiFiMacAddress,totalStorageSpaceInBytes,freeStorageSpaceInBytes,isEncrypted,isSupervised,managementState,enrolledDateTime,deviceEnrollmentType").then(function(d){
      var devices=(d.value||[]);
      var found=devices.find(function(dev){return(dev.deviceName||"").toLowerCase()===searchTerm.toLowerCase()||(dev.serialNumber||"").toLowerCase()===searchTerm.toLowerCase()||dev.id===searchTerm;});
      if(!found)found=devices.find(function(dev){return(dev.deviceName||"").toLowerCase().includes(searchTerm.toLowerCase());});
      if(!found)return{content:[{type:"text",text:"No device found matching: "+searchTerm}]};
      var gb=1073741824;
      var detail={id:found.id,name:found.deviceName,user:found.userDisplayName,email:found.userPrincipalName,os:found.operatingSystem+" "+found.osVersion,compliance:found.complianceState,serial:found.serialNumber,model:found.manufacturer+" "+found.model,imei:found.imei,wifiMac:found.wiFiMacAddress,storage:{totalGB:Math.round(found.totalStorageSpaceInBytes/gb*10)/10,freeGB:Math.round(found.freeStorageSpaceInBytes/gb*10)/10},encrypted:found.isEncrypted,supervised:found.isSupervised,managementState:found.managementState,enrolled:found.enrolledDateTime,lastSync:found.lastSyncDateTime};
      return{content:[{type:"text",text:JSON.stringify(detail,null,2)}]};
    }).catch(function(e){return{content:[{type:"text",text:"get_intune_device error: "+e.message}]};});
  }
  if(name==="get_noncompliant_devices"){
    var ncPath="/deviceManagement/managedDevices?$filter=complianceState%20eq%20'noncompliant'&$top=50&$select=id,deviceName,operatingSystem,osVersion,userDisplayName,userPrincipalName,serialNumber,lastSyncDateTime,model,manufacturer";
    if(args.platform)ncPath="/deviceManagement/managedDevices?$filter=complianceState%20eq%20'noncompliant'%20and%20operatingSystem%20eq%20'"+args.platform+"'&$top=50&$select=id,deviceName,operatingSystem,osVersion,userDisplayName,userPrincipalName,serialNumber,lastSyncDateTime";
    return graphGet(ncPath).then(function(d){
      var devices=(d.value||[]);
      if(!devices.length)return{content:[{type:"text",text:"✓ No non-compliant devices found"+(args.platform?" for "+args.platform:"")+"!"}]};
      var list=devices.map(function(dev){return{name:dev.deviceName,user:dev.userDisplayName,os:dev.operatingSystem+" "+dev.osVersion,serial:dev.serialNumber,lastSync:dev.lastSyncDateTime};});
      return{content:[{type:"text",text:"⚠ "+devices.length+" non-compliant device(s):\n\n"+JSON.stringify(list,null,2)}]};
    }).catch(function(e){return{content:[{type:"text",text:"get_noncompliant_devices error: "+e.message}]};});
  }
  if(name==="get_device_compliance"){
    if(!args.user&&!args.device)return Promise.resolve({content:[{type:"text",text:"Provide either a user email or device name."}]});
    var compPath=args.device?"/deviceManagement/managedDevices?$filter=deviceName%20eq%20'"+encodeURIComponent(args.device)+"'&$top=5":"/deviceManagement/managedDevices?$top=100";
    return graphGet(compPath+"&$select=id,deviceName,complianceState,operatingSystem,osVersion,userDisplayName,userPrincipalName,lastSyncDateTime,isEncrypted,passcodeCompliant").then(function(d){
      var devices=(d.value||[]);
      if(args.user){var u=args.user.toLowerCase();devices=devices.filter(function(dev){return(dev.userPrincipalName||"").toLowerCase().includes(u)||(dev.userDisplayName||"").toLowerCase().includes(u);});}
      if(!devices.length)return{content:[{type:"text",text:"No devices found for: "+(args.user||args.device)}]};
      var result=devices.map(function(dev){return{device:dev.deviceName,compliance:dev.complianceState,os:dev.operatingSystem+" "+dev.osVersion,encrypted:dev.isEncrypted,lastSync:dev.lastSyncDateTime,user:dev.userDisplayName};});
      return{content:[{type:"text",text:JSON.stringify(result,null,2)}]};
    }).catch(function(e){return{content:[{type:"text",text:"get_device_compliance error: "+e.message}]};});
  }
  if(name==="sync_intune_device"){
    return graphGet("/deviceManagement/managedDevices/"+args.device_id).then(function(dev){
      var b=JSON.stringify({});
      return getGraphToken().then(function(t){return new Promise(function(resolve,reject){var data=Buffer.from(b,"utf8");var r=https.request({hostname:"graph.microsoft.com",path:"/v1.0/deviceManagement/managedDevices/"+args.device_id+"/syncDevice",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":data.length}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){resolve({status:re.statusCode,body:d});});});r.on("error",reject);r.write(data);r.end();});}).then(function(r){if(r.status===204||r.status===200)return{content:[{type:"text",text:"✓ Sync triggered for device: "+(dev.deviceName||args.device_id)+". Device will check in shortly."}]};return{content:[{type:"text",text:"Sync request returned HTTP "+r.status+": "+r.body}]};});
    }).catch(function(e){return{content:[{type:"text",text:"sync_intune_device error: "+e.message}]};});
  }
  if(name==="get_intune_apps"){
    var appPath="/deviceAppManagement/mobileApps?$top="+(args.limit||20)+"&$select=id,displayName,publisher,appAvailability,publishingState,createdDateTime";
    if(args.app_name)appPath+="&$filter=contains(displayName,'"+encodeURIComponent(args.app_name)+"')";
    return graphGet(appPath).then(function(d){
      var apps=(d.value||[]).map(function(a){return{name:a.displayName,publisher:a.publisher,state:a.publishingState,available:a.appAvailability,created:a.createdDateTime};});
      return{content:[{type:"text",text:apps.length?JSON.stringify(apps,null,2):"No apps found"+(args.app_name?" matching: "+args.app_name:"")+"."}]};
    }).catch(function(e){return{content:[{type:"text",text:"get_intune_apps error: "+e.message}]};});
  }
  if(name==="sync_vendor_docs"){var validVendors=["cisco","dell","hp","hpe","fujitsu","apple"];if(!validVendors.includes((args.vendor||"").toLowerCase()))return Promise.resolve({content:[{type:"text",text:"Invalid vendor. Use: cisco, dell, hp, hpe, or fujitsu"}]});return syncVendorDocsToKB(args.vendor,args.topic,args.library||"troubleshooting",args.max_articles||3).then(function(r){var msg=r.uploaded>0?"Synced "+r.uploaded+" "+r.vendor.toUpperCase()+" article(s) to "+r.library+":\n"+r.articles.map(function(a){return"• "+a.title+" ("+a.file+")";}).join("\n"):"No "+r.vendor.toUpperCase()+" articles found or uploaded for: "+args.topic+". Skipped: "+r.skipped;return{content:[{type:"text",text:msg}]};}).catch(function(e){return{content:[{type:"text",text:"sync_vendor_docs error: "+e.message}]};});}
  if(name==="list_library"){return getDrives().then(function(drives){var drive=drives.find(function(d){return d.name.toLowerCase()===args.library.toLowerCase();});if(!drive)return{content:[{type:"text",text:"Available: "+drives.map(function(d){return d.name;}).join(", ")}]};return graph("/drives/"+drive.id+"/root/children").then(function(d){return{content:[{type:"text",text:JSON.stringify((d.value||[]).map(function(f){return{name:f.name,id:f.id,driveId:drive.id};}),null,2)}]};})});}
  if(name==="read_file"){return graph("/drives/"+args.drive_id+"/items/"+args.item_id).then(function(meta){var url=meta["@microsoft.graph.downloadUrl"];if(!url)return{content:[{type:"text",text:"Cannot download."}]};var u=new URL(url);return new Promise(function(resolve,reject){https.get({hostname:u.hostname,path:u.pathname+u.search},function(res){var d="";res.on("data",function(c){d+=c;});res.on("end",function(){resolve({content:[{type:"text",text:d.substring(0,8000)}]});});}).on("error",reject);});});}
  if(name==="ms_service_health"){var flt=args&&args.service?"status ne 'resolved' and contains(service,'"+String(args.service).replace(/'/g,"''")+"')":"status ne 'resolved'";var p="/admin/serviceAnnouncement/issues?$filter="+encodeURIComponent(flt);if(!args||!args.service)p+="&$top=10";return graphGet(p).then(function(d){var issues=(d.value||[]).map(function(i){return{title:i.title,service:i.service,status:i.status,severity:i.classification};});return{content:[{type:"text",text:issues.length?"Active issues:\n"+JSON.stringify(issues,null,2):"All Microsoft 365 services healthy!"}]};}).catch(function(e){return{content:[{type:"text",text:"ms_service_health error: "+e.message}]};});}
  if(name==="ms_maintenance"){return graph("/admin/serviceAnnouncement/messages?$filter=messageType%20eq%20%27planForChange%27&$top=5").then(function(d){var msgs=(d.value||[]).map(function(m){return{title:m.title,services:m.services,published:m.publishedDateTime};});return{content:[{type:"text",text:msgs.length?JSON.stringify(msgs,null,2):"No upcoming planned maintenance."}]};});}
  if(name==="cisco_advisories"){return getCiscoToken().then(function(t){return req({hostname:"apix.cisco.com",path:"/security/advisories/v2/product?product="+encodeURIComponent(args.product),method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}});}).then(function(r){var a=(r.body.advisories||[]).slice(0,5).map(function(a){return{title:a.advisoryTitle,severity:a.sir,cves:a.cves,published:a.publishedOn};});return{content:[{type:"text",text:a.length?JSON.stringify(a,null,2):"No advisories for: "+args.product}]};}).catch(function(e){return{content:[{type:"text",text:"Cisco error: "+e.message}]};});}
  if(name==="cisco_cve"){return getCiscoToken().then(function(t){return req({hostname:"apix.cisco.com",path:"/security/advisories/v2/cve/"+encodeURIComponent(args.cve),method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}});}).then(function(r){return{content:[{type:"text",text:JSON.stringify(r.body,null,2)}]};}).catch(function(e){return{content:[{type:"text",text:"CVE error: "+e.message}]};});}
  if(name==="search_microsoft_learn"){return req({hostname:"learn.microsoft.com",path:"/api/search?search="+encodeURIComponent(args.query)+"&locale=en-us&$top=5",method:"GET",headers:{Accept:"application/json"}}).then(function(r){var results=(r.body.results||[]).map(function(i){return{title:i.title,url:i.url,description:i.description};});return{content:[{type:"text",text:results.length?JSON.stringify(results,null,2):"No results for: "+args.query}]};}).catch(function(e){return{content:[{type:"text",text:"MS Learn error: "+e.message}]};});}
  if(name==="web_search"){return req({hostname:"html.duckduckgo.com",path:"/html/?q="+encodeURIComponent(args.query),method:"GET",headers:{"User-Agent":"Mozilla/5.0","Accept":"text/html"}}).then(function(r){var text=typeof r.body==="string"?r.body:JSON.stringify(r.body);var s=[];var rx=/class="result__snippet"[^>]*>([^<]{20,300})/g;var m;while((m=rx.exec(text))!==null&&s.length<5)s.push(m[1].trim());return{content:[{type:"text",text:s.length?s.join("\n\n---\n\n"):"Search done for: "+args.query}]};}).catch(function(e){return{content:[{type:"text",text:"Search error: "+e.message}]};});}
  if(name==="send_email"){var isHtml=(args.is_html!==false);var mailBody=JSON.stringify({message:{subject:args.subject,body:{contentType:isHtml?"HTML":"Text",content:args.body},toRecipients:[{emailAddress:{address:args.to}}]},saveToSentItems:true});return getSPToken().then(function(t){return new Promise(function(resolve,reject){var data=Buffer.from(mailBody,"utf8");var r=https.request({hostname:"graph.microsoft.com",path:"/v1.0/users/"+encodeURIComponent(SENDER_EMAIL)+"/sendMail",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":data.length}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){resolve({status:re.statusCode,body:d});});});r.on("error",reject);r.write(data);r.end();});}).then(function(r){if(r.status===202||r.status===200)return{content:[{type:"text",text:"Email sent to "+args.to}]};return{content:[{type:"text",text:"Email failed (HTTP "+r.status+"): "+r.body}]};}).catch(function(e){return{content:[{type:"text",text:"Email error: "+e.message}]};});}
  if(name==="upload_to_kb"){var LIBRARY_DRIVES={"faqs":"b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-0YkaK7sToQb9UfBCD0V8l","troubleshooting":"b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-s9M-vo64gR6RqcavYF4co","runbooks":"b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d8ntgJz28NVQ5IBUqynE4Gk","assets":"b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9OV5yeNjEWSZzs4VJ2fbAB","cabling":"b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9lg9HgzNLwT7cu7swCUvqF"};var driveId=LIBRARY_DRIVES[(args.library||"").toLowerCase()];if(!driveId)return Promise.resolve({content:[{type:"text",text:"Unknown library. Use: FAQs, Runbooks, Troubleshooting, Assets, or Cabling"}]});var fileData=Buffer.from(args.content,"utf8");return getSPToken().then(function(t){return new Promise(function(resolve,reject){var r=https.request({hostname:"graph.microsoft.com",path:"/v1.0/drives/"+driveId+"/root:/"+encodeURIComponent(args.filename)+":/content",method:"PUT",headers:{Authorization:"Bearer "+t,"Content-Type":"text/plain; charset=utf-8","Content-Length":fileData.length}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{resolve({status:re.statusCode,body:JSON.parse(d)});}catch(e){resolve({status:re.statusCode,body:d});}});});r.on("error",reject);r.write(fileData);r.end();});}).then(function(r){if(r.status===200||r.status===201)return{content:[{type:"text",text:"Uploaded "+args.filename+" to "+args.library}]};return{content:[{type:"text",text:"Upload failed (HTTP "+r.status+"): "+JSON.stringify(r.body)}]};}).catch(function(e){return{content:[{type:"text",text:"Upload error: "+e.message}]};});}

  // Azure AD tools
  if(name==="get_user"){var sel="id,displayName,userPrincipalName,mail,accountEnabled,department,jobTitle,officeLocation,mobilePhone,createdDateTime,lastPasswordChangeDateTime";return graphGet("/users/"+encodeURIComponent(args.user_id)+"?$select="+sel).then(function(u){return{content:[{type:"text",text:JSON.stringify({displayName:u.displayName,upn:u.userPrincipalName,accountEnabled:u.accountEnabled,department:u.department,jobTitle:u.jobTitle,lastPasswordChange:u.lastPasswordChangeDateTime},null,2)}]};}).catch(function(e){return{content:[{type:"text",text:"get_user error: "+e.message}]};});}
  if(name==="search_users"){return graphSearch("/users",{"$search":'"displayName:'+args.query+'" OR "mail:'+args.query+'"',"$top":args.limit||10,"$select":"id,displayName,userPrincipalName,accountEnabled,department,jobTitle","$orderby":"displayName"}).then(function(d){var users=(d.value||[]).map(function(u){return{name:u.displayName,upn:u.userPrincipalName,enabled:u.accountEnabled,dept:u.department};});return{content:[{type:"text",text:users.length?JSON.stringify(users,null,2):"No users found matching: "+args.query}]};}).catch(function(e){return{content:[{type:"text",text:"search_users error: "+e.message}]};});}
  if(name==="get_user_groups"){return graphGet("/users/"+encodeURIComponent(args.user_id)+"/memberOf?$select=id,displayName,description").then(function(d){var groups=(d.value||[]).map(function(g){return{name:g.displayName,description:g.description};});return{content:[{type:"text",text:groups.length?JSON.stringify(groups,null,2):"No groups found for: "+args.user_id}]};}).catch(function(e){return{content:[{type:"text",text:"get_user_groups error: "+e.message}]};});}
  if(name==="list_devices"){var dPath="/devices?$top=50&$select=id,displayName,operatingSystem,operatingSystemVersion,isCompliant,isManaged,registeredDateTime";if(args.filter)dPath+="&$filter="+encodeURIComponent(args.filter);return graphGet(dPath).then(function(d){return{content:[{type:"text",text:(d.value||[]).length?JSON.stringify(d.value,null,2):"No devices found."}]};}).catch(function(e){return{content:[{type:"text",text:"list_devices error: "+e.message}]};});}
  if(name==="get_sign_in_logs"){var lim=args.limit||25;var logPath="/auditLogs/signIns?$top="+encodeURIComponent(lim)+"&$orderby="+encodeURIComponent("createdDateTime desc")+"&$select=createdDateTime,userDisplayName,userPrincipalName,appDisplayName,ipAddress,status,location";if(args.user_id)logPath+="&$filter="+encodeURIComponent("userPrincipalName eq '"+String(args.user_id).replace(/'/g,"''")+"'");return graphGet(logPath).then(function(d){return{content:[{type:"text",text:(d.value||[]).length?JSON.stringify(d.value,null,2):"No sign-in logs found."}]};}).catch(function(e){return{content:[{type:"text",text:"get_sign_in_logs error: "+e.message}]};});}

  // Teams tools
  if(name==="list_teams"){return graphGet("/groups?$filter=resourceProvisioningOptions/Any(x:x%20eq%20%27Team%27)&$select=id,displayName,description").then(function(d){return{content:[{type:"text",text:JSON.stringify((d.value||[]).map(function(t){return{id:t.id,name:t.displayName};}),null,2)}]};}).catch(function(e){return{content:[{type:"text",text:"list_teams error: "+e.message}]};});}
  if(name==="list_channels"){return graphGet("/teams/"+args.team_id+"/channels?$select=id,displayName,membershipType").then(function(d){return{content:[{type:"text",text:JSON.stringify((d.value||[]).map(function(c){return{id:c.id,name:c.displayName};}),null,2)}]};}).catch(function(e){return{content:[{type:"text",text:"list_channels error: "+e.message}]};});}
  if(name==="get_channel_messages"){return graphGet("/teams/"+args.team_id+"/channels/"+args.channel_id+"/messages?$top="+(args.limit||10)).then(function(d){var msgs=(d.value||[]).map(function(m){return{from:(m.from&&m.from.user&&m.from.user.displayName)||"unknown",time:m.createdDateTime,message:(m.body&&m.body.content||"").replace(/<[^>]+>/g," ").trim().substring(0,300)};});return{content:[{type:"text",text:msgs.length?JSON.stringify(msgs,null,2):"No messages found."}]};}).catch(function(e){return{content:[{type:"text",text:"get_channel_messages error: "+e.message}]};});}
  if(name==="send_channel_message"){var wUrl=new URL(TEAMS_WEBHOOK_URL);var wBody=JSON.stringify({"@type":"MessageCard","@context":"http://schema.org/extensions","summary":args.message,"themeColor":"0076D7","text":args.html?args.message:"<pre>"+args.message+"</pre>"});return new Promise(function(resolve){var d=Buffer.from(wBody,"utf8");var r=https.request({hostname:wUrl.hostname,path:wUrl.pathname+wUrl.search,method:"POST",headers:{"Content-Type":"application/json","Content-Length":d.length}},function(re){var rb="";re.on("data",function(c){rb+=c;});re.on("end",function(){resolve({content:[{type:"text",text:re.statusCode===200?"Message posted to Teams — General channel":"Teams error (HTTP "+re.statusCode+"): "+rb}]});});});r.on("error",function(e){resolve({content:[{type:"text",text:"send_channel_message error: "+e.message}]});});r.write(d);r.end();});}

  if(name==="build_scenario"){return handleTool("search_kb",{query:args.problem}).then(function(kb){return Promise.all([Promise.resolve(kb),handleTool("ms_service_health",{}),handleTool("search_microsoft_learn",{query:args.problem})]);}).then(function(results){var now=new Date().toISOString().split("T")[0];var md="# Field Scenario: "+args.problem+"\n\n_Generated: "+now+"_\n\n";md+="## KB Results\n\n"+results[0].content[0].text+"\n\n";md+="## M365 Health\n\n"+results[1].content[0].text+"\n\n";md+="## Microsoft Learn\n\n"+results[2].content[0].text;return{content:[{type:"text",text:md}]};});}

  // ── create_workflow ───────────────────────────────────────────────────────
  if(name==="create_workflow"){
    var wfTitle=args.title||"IT Workflow";
    var wfType=args.task_type||"custom";
    var wfSection={cisco_phone:"Cisco Phone Installs",autopilot:"Autopilot Deployments",printer:"Printer Setup",network:"Network Configuration",custom:"Custom Workflows"}[wfType]||"Custom Workflows";
    var wfTemplates={
      cisco_phone:[["Pre-Installation Checks",["Unbox phone and verify model matches work order","Confirm MAC address matches deployment sheet","Check PoE switch port is active and tagged to voice VLAN","Confirm DHCP scope has available IPs on voice VLAN","Confirm CUCM device profile ready for this MAC"]],["Physical Installation",["Mount bracket and place phone","Connect ethernet cable to PoE switch port","Connect handset cable to phone base","Power on and confirm boot screen appears","Note IP address displayed during boot"]],["Phone Registration",["Confirm phone registers in CUCM","Verify correct extension shown on screen","Test internal call — audio both directions","Test external call via PSTN","Confirm voicemail routes correctly"]],["Configuration",["Set correct time zone (Settings > User Preferences)","Configure speed dials per user request","Test intercom and call pickup group","Verify BLF keys if applicable","Label phone with extension and user name"]],["Sign-Off",["User confirmed phone is working","Photo taken of installation","Work order updated: MAC, IP, extension, switch port, location","Post completion to Teams IT channel"]]],
      autopilot:[["Pre-Deployment Checks",["Confirm serial number registered in Intune/Autopilot","Verify Autopilot profile assigned to device","Confirm user M365 licence is active","Confirm user MFA configured","Check network available at deployment site"]],["Hardware Setup",["Unbox and connect to power","Power on and wait for OOBE screen","Select region and keyboard layout","Confirm network connection"]],["Autopilot Enrollment",["Enter user corporate email address","Wait for Autopilot profile to download","Confirm organisation branding appears","Complete MFA when prompted","DO NOT interrupt - wait for policies to apply"]],["Account Verification",["Confirm OneDrive sync starts","Open Outlook - confirm mailbox loads","Open Teams - confirm correct account","Connect VPN - confirm it works","Check Intune compliance shows Compliant"]],["Sign-Off",["User confirmed device is working","Intune shows Compliant","Device name and serial in work order","Old device collected if applicable","Post completion to Teams IT channel"]]]
    };
    var steps=wfTemplates[wfType]||[["Steps",["Add your steps here"]]];
    var dateStr=new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
    var html="<!DOCTYPE html><html><head><title>"+wfTitle+"</title></head><body>";
    html+="<h1>"+wfTitle+"</h1>";
    html+="<p><b>Date:</b> "+dateStr+" | <b>Tech:</b> "+(args.tech_name||"___________")+" | <b>Site:</b> "+(args.site||"___________")+"</p>";
    if(args.notes)html+="<p><b>Notes:</b> "+args.notes+"</p><hr/>";
    steps.forEach(function(s){
      html+="<h2>"+s[0]+"</h2>";
      s[1].forEach(function(item){html+="<p data-tag=\"to-do\">"+item+"</p>";});
    });
    html+="<h2>Job Complete</h2>";
    html+="<p data-tag=\"to-do\">All steps completed and verified</p>";
    html+="<p data-tag=\"to-do\">Post completion to Teams IT channel</p>";
    html+="</body></html>";
    return getSPToken().then(function(t){
      return new Promise(function(res,rej){var r=require("https").request({hostname:"graph.microsoft.com",path:"/v1.0/sites/claudeitagent.sharepoint.com:/sites/ITKnowledgeBase:/onenote/notebooks",method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{res(JSON.parse(d));}catch(e){res({value:[]});}});});r.on("error",rej);r.end();});
    }).then(function(nbs){
      var nb=(nbs.value||[]).find(function(n){return n.displayName==="IT Workflows";});
      var nbPromise=nb?Promise.resolve(nb.id):getSPToken().then(function(t){var b=JSON.stringify({displayName:"IT Workflows"});return new Promise(function(res,rej){var r=require("https").request({hostname:"graph.microsoft.com",path:"/v1.0/sites/claudeitagent.sharepoint.com:/sites/ITKnowledgeBase:/onenote/notebooks",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{res(JSON.parse(d).id);}catch(e){res(null);}});});r.on("error",rej);r.write(b);r.end();});});
      return nbPromise;
    }).then(function(nbId){
      if(!nbId)return{content:[{type:"text",text:"Could not create or find IT Workflows notebook. Please run create-onenote-workflows.ps1 first."}]};
      return getSPToken().then(function(t){
        return new Promise(function(res,rej){var b=JSON.stringify({displayName:wfSection});var r=require("https").request({hostname:"graph.microsoft.com",path:"/v1.0/sites/claudeitagent.sharepoint.com:/sites/ITKnowledgeBase:/onenote/notebooks/"+nbId+"/sections",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{res(JSON.parse(d));}catch(e){res({id:null});}});});r.on("error",rej);r.write(b);r.end();});
      }).then(function(sec){
        if(!sec.id)return{content:[{type:"text",text:"Could not create section in notebook."}]};
        var pageData=Buffer.from(html,"utf8");
        return getSPToken().then(function(t){
          return new Promise(function(resolve,reject){
            var r=require("https").request({hostname:"graph.microsoft.com",path:"/v1.0/sites/claudeitagent.sharepoint.com:/sites/ITKnowledgeBase:/onenote/sections/"+sec.id+"/pages",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/xhtml+xml","Content-Length":pageData.length}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{var p=JSON.parse(d);var url=p.links&&p.links.oneNoteWebUrl&&p.links.oneNoteWebUrl.href||"";resolve({content:[{type:"text",text:"Workflow created: "+wfTitle+"\nOneNote link: "+url+"\n\nShare this link with your field tech. They can open it on mobile and tick each checkbox as they complete the step."}]});}catch(e){resolve({content:[{type:"text",text:"Page created. Open IT Workflows notebook in OneNote to view."}]});}});});
            r.on("error",reject);r.write(pageData);r.end();
          });
        });
      });
    }).catch(function(e){return{content:[{type:"text",text:"create_workflow error: "+e.message}]};});
  }

  // ── Microsoft Lists workflow ─────────────────────────────────────────────
  if(name==="create_list_workflow"){
    var listTitle=args.title||"IT Workflow";
    var taskType=args.task_type||"custom";
    var techName=args.tech_name||"Field Tech";
    var site=args.site||"";
    var WORKFLOW_STEPS={
      cisco_phone:["Unbox phone and verify model matches work order","Confirm MAC address matches deployment sheet","Check PoE switch port is active and tagged to voice VLAN","Confirm CUCM device profile ready for this MAC","Mount bracket and connect ethernet cable to PoE port","Connect handset cable and power on phone","Confirm phone registers in CUCM","Verify correct extension shown on screen","Test internal call — audio both directions","Test external call via PSTN","Set correct time zone in Settings > User Preferences","Configure speed dials per user request","Label phone with extension and user name","User confirmed phone is working","Photo taken and work order updated","Post completion to Teams IT channel"],
      autopilot:["Confirm serial number registered in Intune/Autopilot","Verify Autopilot profile assigned to device","Confirm user M365 licence is active","Check network available at site","Unbox device and connect to power","Power on and wait for OOBE screen","Select region and keyboard layout","Enter user corporate email address","Wait for Autopilot profile to download","Complete MFA when prompted","Wait for all policies to apply — do NOT interrupt","Confirm OneDrive sync starts","Open Outlook — confirm mailbox loads","Open Teams — confirm correct account","Connect VPN — confirm it works","Check Intune compliance shows Compliant","Run Windows Update","User confirmed device working","Device serial recorded in work order","Post completion to Teams IT channel"]
    };
    var steps=args.steps||(WORKFLOW_STEPS[taskType]||["Complete task steps"]);

    return getSiteId().then(function(siteId){
      // Create Microsoft List
      var listBody=JSON.stringify({
        displayName:listTitle,
        description:"IT workflow checklist for "+techName+(site?" at "+site:""),
        list:{template:"genericList"},
        columns:[
          {name:"Step",text:{allowMultipleLines:false},required:true},
          {name:"Complete",boolean:{},required:false},
          {name:"Notes",text:{allowMultipleLines:true},required:false}
        ]
      });
      return getSPToken().then(function(t){
        return new Promise(function(resolve,reject){
          var d=Buffer.from(listBody,"utf8");
          var r=require("https").request({hostname:"graph.microsoft.com",path:"/v1.0/sites/"+siteId+"/lists",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":d.length}},function(re){var s="";re.on("data",function(c){s+=c;});re.on("end",function(){try{resolve(JSON.parse(s));}catch(e){resolve({error:s});}});});
          r.on("error",reject);r.write(d);r.end();
        });
      }).then(function(list){
        if(list.error||!list.id)return{content:[{type:"text",text:"List creation failed: "+JSON.stringify(list)}]};
        var listId=list.id;
        var listUrl=list.webUrl||"";
        // Add each step as a list item
        return getSPToken().then(function(t){
          return steps.reduce(function(p,step,i){
            return p.then(function(){
              var itemBody=JSON.stringify({fields:{Step:(i+1)+". "+step,Complete:false,Notes:""}});
              var d2=Buffer.from(itemBody,"utf8");
              return new Promise(function(resolve,reject){
                var r=require("https").request({hostname:"graph.microsoft.com",path:"/v1.0/sites/"+siteId+"/lists/"+listId+"/items",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":d2.length}},function(re){var s="";re.on("data",function(c){s+=c;});re.on("end",function(){resolve();});});
                r.on("error",reject);r.write(d2);r.end();
              });
            });
          },Promise.resolve());
        }).then(function(){
          // Post Teams message with the list link
          var teamsMsg=JSON.stringify({"@type":"MessageCard","@context":"http://schema.org/extensions","themeColor":"0076D7","summary":listTitle,"sections":[{"activityTitle":"Workflow Created: "+listTitle,"activitySubtitle":"Tech: "+techName+(site?" | Site: "+site:"")+" | Steps: "+steps.length,"facts":[{"name":"Status","value":"In Progress"},{"name":"Access","value":"Open on mobile via Teams > Lists tab"}],"markdown":true}],"potentialAction":[{"@type":"OpenUri","name":"Open Checklist","targets":[{"os":"default","uri":listUrl}]}]});
          var wUrl=new URL(TEAMS_WEBHOOK_URL);
          var d3=Buffer.from(teamsMsg,"utf8");
          return new Promise(function(resolve){
            var r=require("https").request({hostname:wUrl.hostname,path:wUrl.pathname+wUrl.search,method:"POST",headers:{"Content-Type":"application/json","Content-Length":d3.length}},function(re){resolve(re.statusCode);});
            r.on("error",function(){resolve(0);});r.write(d3);r.end();
          }).then(function(){
            return{content:[{type:"text",text:"Workflow checklist created: "+listTitle+"\n\nSharePoint List URL: "+listUrl+"\n\nThe checklist has been posted to the Teams IT channel. Field tech can open it on mobile via Teams > Lists tab or the link above.\n\nSteps added: "+steps.length}]};
          });
        });
      });
    }).catch(function(e){return{content:[{type:"text",text:"create_list_workflow error: "+e.message}]};});
  }

  return Promise.resolve({content:[{type:"text",text:"Unknown tool: "+name}]});
}

// ── Auth check ────────────────────────────────────────────────────────────────
function checkAuth(reqHttp) {
  var auth = reqHttp.headers["authorization"] || "";
  return auth === "Bearer " + API_KEY;
}

// ── MCP SSE transport ─────────────────────────────────────────────────────────
function handleSSE(reqHttp, res) {
  if (!checkAuth(reqHttp)) {
    res.writeHead(401, {"Content-Type": "application/json"});
    res.end(JSON.stringify({error: "Unauthorized — provide Authorization: Bearer <api-key>"}));
    return;
  }
  var sessionId = crypto.randomUUID();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  sessions.set(sessionId, res);
  // Send endpoint event — tells Claude where to POST messages
  res.write("event: endpoint\ndata: /message?sessionId=" + sessionId + "\n\n");
  // Keep-alive ping every 30s
  var ping = setInterval(function() {
    if (sessions.has(sessionId)) {
      res.write(": ping\n\n");
    } else {
      clearInterval(ping);
    }
  }, 30000);
  reqHttp.on("close", function() {
    sessions.delete(sessionId);
    clearInterval(ping);
  });
}

function handleMessage(reqHttp, res) {
  if (!checkAuth(reqHttp)) {
    res.writeHead(401, {"Content-Type": "application/json"});
    res.end(JSON.stringify({error: "Unauthorized"}));
    return;
  }
  var url = new URL(reqHttp.url, "http://localhost");
  var sessionId = url.searchParams.get("sessionId");
  var sseRes = sessions.get(sessionId);
  if (!sseRes) {
    res.writeHead(404, {"Content-Type": "application/json"});
    res.end(JSON.stringify({error: "Session not found"}));
    return;
  }
  var body = "";
  reqHttp.on("data", function(c) { body += c; });
  reqHttp.on("end", function() {
    res.writeHead(202);
    res.end();
    try {
      var msg = JSON.parse(body);
      processMCP(msg, sseRes);
    } catch(e) {
      sendSSE(sseRes, {jsonrpc:"2.0",id:null,error:{code:-32700,message:"Parse error"}});
    }
  });
}

function sendSSE(sseRes, data) {
  sseRes.write("event: message\ndata: " + JSON.stringify(data) + "\n\n");
}

function processMCP(msg, sseRes) {
  if (!msg || !msg.method) return;
  if (msg.method === "initialize") {
    sendSSE(sseRes, {jsonrpc:"2.0",id:msg.id,result:{
      protocolVersion:"2025-11-25",
      capabilities:{tools:{listChanged:false}},
      serverInfo:{name:"it-knowledge-agent",version:"10.0.0"}
    }});
  } else if (msg.method === "notifications/initialized") {
    // no response needed
  } else if (msg.method === "tools/list") {
    sendSSE(sseRes, {jsonrpc:"2.0",id:msg.id,result:{tools:TOOLS}});
  } else if (msg.method === "tools/call") {
    var name = msg.params && msg.params.name;
    var args = (msg.params && msg.params.arguments) || {};
    handleTool(name, args).then(function(result) {
      sendSSE(sseRes, {jsonrpc:"2.0",id:msg.id,result:result});
    }).catch(function(e) {
      sendSSE(sseRes, {jsonrpc:"2.0",id:msg.id,result:{content:[{type:"text",text:"Error: "+e.message}]}});
    });
  } else if (msg.id !== undefined) {
    sendSSE(sseRes, {jsonrpc:"2.0",id:msg.id,result:{}});
  }
}

// ── Chat intent router ────────────────────────────────────────────────────────
function extractName(msg, keywords) {
  for (var kw of keywords) {
    var idx = msg.toLowerCase().indexOf(kw.toLowerCase());
    if (idx !== -1) {
      var after = msg.substring(idx + kw.length).trim();
      if (after) return after.split(/[,.\?!\n]/)[0].trim();
    }
  }
  var emailMatch = msg.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (emailMatch) return emailMatch[0];
  return null;
}

function routeChat(message) {
  var m = message.toLowerCase();
  // Non-compliant devices
  if (m.includes("non-compliant")||m.includes("noncompliant")||m.includes("not compliant")||m.includes("out of compliance")||m.includes("compliance issue")) {
    var pl=m.includes("ios")||m.includes("iphone")||m.includes("ipad")?"ios":m.includes("mac")||m.includes("macos")?"macos":m.includes("android")?"android":m.includes("windows")||m.includes("pc")?"windows":null;
    return {tool:"get_noncompliant_devices",args:pl?{platform:pl}:{}};
  }
  // List/all devices
  if ((m.includes("list")||m.includes("all")||m.includes("show")||m.includes("how many"))&&(m.includes("device")||m.includes("enrolled")||m.includes("managed"))) {
    var pl=m.includes("ios")||m.includes("iphone")||m.includes("ipad")?"ios":m.includes("mac")||m.includes("macos")?"macos":m.includes("android")?"android":m.includes("windows")||m.includes("pc")?"windows":null;
    var userFilter=extractName(message,["devices for","devices owned by","enrolled by"]);
    return {tool:"get_intune_devices",args:Object.assign(pl?{platform:pl}:{},userFilter?{user:userFilter}:{})};
  }
  // Compliance check for user/device
  if (m.includes("complian")&&(m.includes("@")||m.includes("user")||m.includes("device")||m.includes("is "))) {
    var name=extractName(message,["compliance for","compliant is","check","is "," for"]);
    return {tool:"get_device_compliance",args:name?{user:name}:{}};
  }
  // Single device detail
  if ((m.includes("find device")||m.includes("device info")||m.includes("look up device")||m.includes("show device")||m.includes("details for"))&&m.includes("device")) {
    var name=extractName(message,["device named","device called","device info for","find device","show device","details for"]);
    if(name) return {tool:"get_intune_device",args:{device:name}};
  }
  // Sync device
  if (m.includes("sync")&&m.includes("device")) {
    var name=extractName(message,["sync device","sync "]);
    return {tool:name?"get_intune_device":"get_noncompliant_devices",args:name?{device:name}:{},followUp:"sync"};
  }
  // Apps
  if ((m.includes("app")||m.includes("application"))&&(m.includes("deployed")||m.includes("installed")||m.includes("list app")||m.includes("show app"))) {
    var name=extractName(message,["app named","app called","app "]);
    return {tool:"get_intune_apps",args:name?{app_name:name}:{}};
  }
  // User lookup
  if (m.includes("who is")||m.includes("look up user")||m.includes("find user")||m.includes("user info")||m.includes("search user")) {
    var name=extractName(message,["who is","look up user","find user","user info for","search for user","search user"]);
    if(name&&name.includes("@")) return {tool:"get_user",args:{user_id:name}};
    if(name) return {tool:"search_users",args:{query:name}};
  }
  // Sign-in logs
  if (m.includes("sign-in")||m.includes("signin")||m.includes("login log")||m.includes("login history")||m.includes("access log")||m.includes("who logged in")) {
    var name=extractName(message,["sign-in for","signin for","login for","logs for","history for"]);
    return {tool:"get_sign_in_logs",args:name?{user_id:name,limit:10}:{limit:10}};
  }
  // User groups
  if ((m.includes("group")||m.includes("member of"))&&(m.includes("user")||m.includes("@"))) {
    var name=extractName(message,["groups for","member of","groups of"]);
    if(name) return {tool:"get_user_groups",args:{user_id:name}};
  }
  // Service health
  if (m.includes("service health")||m.includes("outage")||(m.includes("down")&&(m.includes("teams")||m.includes("outlook")||m.includes("sharepoint")||m.includes("m365")||m.includes("office")))||m.includes("is microsoft down")) {
    var svc=m.includes("teams")?"Teams":m.includes("outlook")||m.includes("exchange")?"Exchange":m.includes("sharepoint")?"SharePoint":m.includes("onedrive")?"OneDrive":null;
    return {tool:"ms_service_health",args:svc?{service:svc}:{}};
  }
  // Maintenance
  if (m.includes("maintenance")||m.includes("planned change")||m.includes("upcoming update")) {
    return {tool:"ms_maintenance",args:{}};
  }
  // Cisco advisories / CVE
  if ((m.includes("advisory")||m.includes("advisories")||m.includes("vulnerability"))&&m.includes("cisco")) {
    var product=extractName(message,["cisco","advisory for","vulnerabilit"]);
    return {tool:"cisco_advisories",args:{product:product||"cisco"}};
  }
  if (m.match(/cve-\d{4}-\d+/i)) {
    var cve=m.match(/cve-\d{4}-\d+/i)[0].toUpperCase();
    return {tool:"cisco_cve",args:{cve:cve}};
  }
  // Teams messages
  if ((m.includes("teams message")||m.includes("channel message")||m.includes("recent message"))&&m.includes("teams")) {
    return {tool:"get_channel_messages",args:{team_id:TEAMS_TEAM_ID,channel_id:TEAMS_CHANNEL_ID,limit:5}};
  }
  // Vendor docs
  if (m.includes("cisco")||m.includes("dell")||m.includes("hp ")||m.includes("hewlett")||m.includes("fujitsu")||m.includes("apple")||m.includes("macbook")||m.includes("iphone")||m.includes("ipad")) {
    return {tool:"search_kb",args:{query:message}};
  }
  // Default: KB search
  return {tool:"search_kb",args:{query:message}};
}

function formatChatResponse(toolName, rawText) {
  if (!rawText||rawText.trim()==="") return "No response received.";

  // No KB results — LOW CONFIDENCE fallback
  if (toolName==="search_kb" && (rawText.includes("No results") || rawText.includes("no results"))) {
    return "[LOW CONFIDENCE]\nArticle ID: N/A | Category: General IT | Severity: Low\n\nI could not find a specific KB article for this issue. Here is my best guidance based on standard IT practice.\n\n"+rawText+"\n\nI recommend raising a support ticket at https://itportal.yourorg.com so this can be formally investigated and potentially added to the KB.\n\nSource: General IT best practice (no KB article found)";
  }
  // Try to parse JSON for richer formatting
  try {
    var data=JSON.parse(rawText);
    if(Array.isArray(data)&&data.length===0) return "[HIGH CONFIDENCE]\nArticle ID: N/A | Category: IT Operations | Severity: Low\n\nNo results found.\n\nSource: Live Azure AD / Intune Data";
    if(Array.isArray(data)) {
      if(toolName==="get_intune_devices"||toolName==="get_noncompliant_devices") {
        var header="[HIGH CONFIDENCE]\nArticle ID: N/A | Category: Device Management | Severity: "+(toolName==="get_noncompliant_devices"?"High":"Low")+"\n\n";
        var body=(toolName==="get_noncompliant_devices"?"⚠️ ":"📱 ")+(data.length)+" device(s) found:\n\n"+data.map(function(d){return "📱 "+d.name+"\n   👤 "+(d.user||d.email||"Unknown")+"\n   💻 "+(d.os||"")+"\n   "+(d.compliance==="compliant"?"✅":"⚠️")+" "+d.compliance+"\n   🕐 Last sync: "+(d.lastSync?new Date(d.lastSync).toLocaleString():"Unknown");}).join("\n\n");
        return header+body+"\n\nSource: Live Intune Data";
      }
      if(toolName==="search_users") return "[HIGH CONFIDENCE]\nArticle ID: N/A | Category: Account Access | Severity: Low\n\n👥 "+data.length+" user(s) found:\n\n"+data.map(function(u){return "👤 "+u.name+"\n   "+u.upn+"\n   "+(u.dept||"No department")+" | "+(u.enabled?"✅ Active":"🔴 Disabled");}).join("\n\n")+"\n\nSource: Live Azure AD Data";
      if(toolName==="get_channel_messages") return "[HIGH CONFIDENCE]\nArticle ID: N/A | Category: Communication | Severity: Low\n\n💬 Recent Teams messages:\n\n"+data.map(function(msg){return "• "+msg.from+" ("+new Date(msg.time).toLocaleString()+"):\n  "+msg.message;}).join("\n\n")+"\n\nSource: Live Microsoft Teams Data";
      if(toolName==="search_kb") return "[HIGH CONFIDENCE]\nArticle ID: N/A | Category: Knowledge Base | Severity: Low\n\n📚 "+data.length+" KB article(s) found:\n\n"+data.map(function(f,i){return (i+1)+". 📄 "+f.name.replace(".md","").replace(/-/g," ")+"\n   Library: "+(f.library||"KB");}).join("\n\n")+"\n\nAsk me to read any of these articles for details.\n\nSource: IT Knowledge Base";
      if(toolName==="get_device_compliance") return "[HIGH CONFIDENCE]\nArticle ID: N/A | Category: Device Management | Severity: Medium\n\n🔍 Compliance status:\n\n"+data.map(function(d){return "📱 "+d.device+"\n   "+(d.compliance==="compliant"?"✅ Compliant":"⚠️ "+d.compliance)+"\n   💻 "+d.os+"\n   🔐 Encrypted: "+(d.encrypted?"Yes":"No")+"\n   🕐 "+new Date(d.lastSync).toLocaleString();}).join("\n\n")+"\n\nSource: Live Intune Compliance Data";
      if(toolName==="get_user_groups") return "[HIGH CONFIDENCE]\nArticle ID: N/A | Category: Account Access | Severity: Low\n\n🏷️ Group memberships:\n\n"+data.map(function(g){return "• "+g.name+(g.description?"\n  "+g.description:"");}).join("\n\n")+"\n\nSource: Live Azure AD Data";
      if(toolName==="get_sign_in_logs") return "[HIGH CONFIDENCE]\nArticle ID: N/A | Category: Security | Severity: Medium\n\n🔐 Recent sign-ins:\n\n"+data.slice(0,8).map(function(s){return "• "+(s.userDisplayName||s.userPrincipalName||"Unknown")+"\n  App: "+(s.appDisplayName||"Unknown")+"\n  IP: "+(s.ipAddress||"Unknown")+"\n  "+(s.status&&s.status.errorCode===0?"✅ Success":"❌ Failed")+"\n  🕐 "+new Date(s.createdDateTime).toLocaleString();}).join("\n\n")+"\n\nSource: Live Azure AD Sign-in Logs";
      if(toolName==="get_intune_apps") return "[HIGH CONFIDENCE]\nArticle ID: N/A | Category: Software & Applications | Severity: Low\n\n📦 "+data.length+" app(s) deployed:\n\n"+data.map(function(a){return "• "+a.name+(a.publisher?"\n  Publisher: "+a.publisher:"")+(a.state?"\n  State: "+a.state:"");}).join("\n\n")+"\n\nSource: Live Intune App Deployment Data";
      return rawText;
    }
    // Single object
    if(toolName==="get_user") return "[HIGH CONFIDENCE]\nArticle ID: N/A | Category: Account Access | Severity: Low\n\n👤 "+data.displayName+"\n📧 "+data.upn+"\n🏢 "+(data.department||"No department")+"\n💼 "+(data.jobTitle||"No title")+"\n"+(data.accountEnabled?"✅ Account active":"🔴 Account disabled")+"\n🔑 Password last changed: "+(data.lastPasswordChange?new Date(data.lastPasswordChange).toLocaleDateString():"Unknown")+"\n\nSource: Live Azure AD Data";
    if(toolName==="get_intune_device") return "[HIGH CONFIDENCE]\nArticle ID: N/A | Category: Hardware | Severity: Low\n\n📱 "+data.name+"\n👤 "+(data.user||data.email||"Unknown")+"\n💻 "+(data.os||"")+"\n🔧 "+(data.model||"")+"\n🔢 Serial: "+(data.serial||"Unknown")+"\n"+(data.compliance==="compliant"?"✅ Compliant":"⚠️ "+data.compliance)+"\n🔐 Encrypted: "+(data.encrypted?"Yes":"No")+"\n💾 Storage: "+(data.storage?data.storage.freeGB+" GB free of "+data.storage.totalGB+" GB":"Unknown")+"\n🕐 Last sync: "+(data.lastSync?new Date(data.lastSync).toLocaleString():"Unknown")+"\n\nSource: Live Intune Device Data";
    return rawText;
  } catch(e) { return rawText; }
}

// ── Chat HTML UI ──────────────────────────────────────────────────────────────
var DEMO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>IT Agent</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1117;color:#e8eaf0;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
header{background:linear-gradient(135deg,#0078d4,#005a9e);padding:14px 18px;display:flex;align-items:center;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,.4);flex-shrink:0}
.dot{width:9px;height:9px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80}
header h1{font-size:17px;font-weight:700;letter-spacing:.3px}
header span{font-size:12px;opacity:.75;margin-left:auto}
#msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
.bubble{max-width:88%;padding:11px 15px;border-radius:18px;font-size:14px;line-height:1.55;word-wrap:break-word;white-space:pre-wrap}
.user{background:#0078d4;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
.agent{background:#1e2130;color:#e8eaf0;align-self:flex-start;border-bottom-left-radius:4px;border:1px solid #2a2d3e}
.agent.loading{color:#6b7280;font-style:italic}
.chips{display:flex;flex-direction:column;gap:10px;margin-top:14px;max-width:640px}
.chip{padding:12px 18px;background:transparent;border:1px solid #2b6cb0;border-radius:999px;font-size:14px;cursor:pointer;color:#cfe1ff;transition:background .15s,border-color .15s;text-align:left;display:block}
.chip:hover{background:rgba(43,108,176,.18);border-color:#4ea1ff}
.chip:active{background:rgba(43,108,176,.28)}
.welcome-title{font-weight:600;font-size:16px;margin-bottom:8px;color:#e8eaf0}
.welcome-body{color:#b8c5db;line-height:1.55}
.welcome-cta{color:#8aa0c2;font-style:italic;margin-top:10px}
.agent.welcome{max-width:760px;background:#1e2130;border:1px solid #2a2d3e;border-radius:14px;padding:18px 20px;position:relative;overflow:hidden}
.agent.welcome::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#4ea1ff,#6f8cff)}
footer{padding:10px 12px;background:#161824;border-top:1px solid #2a2d3e;display:flex;gap:8px;flex-shrink:0}
#inp{flex:1;padding:11px 16px;border-radius:22px;border:1px solid #2a2d3e;background:#1e2130;color:#e8eaf0;font-size:15px;outline:none;transition:border .2s}
#inp:focus{border-color:#0078d4}
#inp::placeholder{color:#6b7280}
button{padding:11px 20px;border-radius:22px;border:none;background:#0078d4;color:#fff;font-size:15px;cursor:pointer;font-weight:600;flex-shrink:0;transition:background .2s}
button:hover{background:#106ebe}
button:active{background:#005a9e}
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#2a2d3e;border-radius:4px}
#gate{position:fixed;inset:0;background:#0f1117;display:flex;align-items:center;justify-content:center;z-index:999;flex-direction:column;gap:20px;padding:24px}
#gate-box{background:#1e2130;border:1px solid #2a2d3e;border-radius:20px;padding:36px 32px;max-width:420px;width:100%;text-align:center}
#gate-box h2{font-size:22px;font-weight:700;margin-bottom:8px;color:#fff}
#gate-box p{font-size:14px;color:#9ca3af;margin-bottom:24px;line-height:1.6}
#gate-code{width:100%;padding:13px 18px;border-radius:12px;border:1px solid #2a2d3e;background:#0f1117;color:#e8eaf0;font-size:16px;text-align:center;outline:none;margin-bottom:14px;letter-spacing:2px}
#gate-code:focus{border-color:#0078d4}
#gate-btn{width:100%;padding:13px;border-radius:12px;border:none;background:#0078d4;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
#gate-btn:hover{background:#106ebe}
#gate-err{color:#f87171;font-size:13px;margin-top:8px;display:none}
.badge{display:inline-block;padding:4px 12px;background:#0078d415;border:1px solid #0078d440;border-radius:20px;font-size:12px;color:#60a5fa;margin-bottom:16px}
</style>
</head>
<body>
<div id="gate">
  <div id="gate-box">
    <div class="badge">🔧 Live Demo</div>
    <h2>Claude IT Support Agent</h2>
    <p>An AI-powered IT support system built on Microsoft Azure, SharePoint, and Anthropic Claude. Ask any IT question and get instant step-by-step guidance.</p>
    <input id="gate-code" type="password" placeholder="Enter access code" onkeydown="if(event.key==='Enter')checkCode()">
    <button id="gate-btn" onclick="checkCode()">Access Demo</button>
    <div id="gate-err">Incorrect access code. Please try again.</div>
  </div>
</div>
<header>
  <div class="dot"></div>
  <h1>🔧 IT Agent</h1>
  <span>Field Support</span>
</header>
<div id="msgs">
  <div class="bubble agent welcome"><div class="welcome-title">Welcome to the Claude IT Support Agent demo!</div>
<div class="welcome-body">I can answer IT questions, retrieve step-by-step procedures from the knowledge base, check Microsoft 365 service health, look up devices and users, and create field tech workflow checklists.</div>
<div class="welcome-cta">Try one of the suggested questions below or ask your own.</div>
<div class="chips">
  <span class="chip" onclick="ask(this.textContent)">New user full workstation + Cisco phone deployment</span>
  <span class="chip" onclick="ask(this.textContent)">No network connectivity at user desk</span>
  <span class="chip" onclick="ask(this.textContent)">Printer install / offline / cannot print issue</span>
  <span class="chip" onclick="ask(this.textContent)">Conference room / Teams / Cisco video room failure</span>
  <span class="chip" onclick="ask(this.textContent)">User laptop replacement / migration</span>
</div>
  </div>
</div>
<footer>
  <input id="inp" placeholder="Ask anything..." autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send()}">
  <button onclick="send()">Send</button>
</footer>
<script>
var API_KEY='claudeITAgent2026';
var DEMO_ACCESS='ITAgent2026Demo';
function checkCode(){
  var v=document.getElementById('gate-code').value.trim();
  if(v===DEMO_ACCESS){
    document.getElementById('gate').style.display='none';
    sessionStorage.setItem('demo_auth','1');
  } else {
    document.getElementById('gate-err').style.display='block';
    document.getElementById('gate-code').style.borderColor='#f87171';
  }
}
if(sessionStorage.getItem('demo_auth')==='1'){document.getElementById('gate').style.display='none';}
function ask(t){document.getElementById('inp').value=t;send()}
function send(){
  var inp=document.getElementById('inp');
  var msg=inp.value.trim();
  if(!msg)return;
  inp.value='';
  addBubble(msg,'user');
  var loader=addBubble('Thinking...','agent loading');
  var controller=new AbortController();
  var timeout=setTimeout(function(){controller.abort();},90000);
  fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY},body:JSON.stringify({message:msg}),signal:controller.signal})
    .then(function(r){clearTimeout(timeout);return r.json();})
    .then(function(d){loader.remove();addBubble(d.response||'No response','agent');})
    .catch(function(e){clearTimeout(timeout);loader.remove();addBubble(e.name==='AbortError'?'Request timed out — please try again':'Error: '+e.message,'agent');});
}
function addBubble(text,cls){
  var d=document.createElement('div');
  d.className='bubble '+cls;
  d.textContent=text;
  var msgs=document.getElementById('msgs');
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;
  return d;
}
document.getElementById('inp').focus();
</script>
</body>
</html>`;

// ── /chat (no gate) — internal field tech use ─────────────────────────────────
// Built from DEMO_HTML with the gate overlay stripped out.
var CHAT_HTML = DEMO_HTML
  // Remove gate CSS rules
  .replace(/\n#gate\{[^\n]+\}/, '')
  .replace(/\n#gate-box\{[^\n]+\}/, '')
  .replace(/\n#gate-box h2\{[^\n]+\}/, '')
  .replace(/\n#gate-box p\{[^\n]+\}/, '')
  .replace(/\n#gate-code\{[^\n]+\}/, '')
  .replace(/\n#gate-code:focus\{[^\n]+\}/, '')
  .replace(/\n#gate-btn\{[^\n]+\}/, '')
  .replace(/\n#gate-btn:hover\{[^\n]+\}/, '')
  .replace(/\n#gate-err\{[^\n]+\}/, '')
  .replace(/\n\.badge\{[^\n]+\}/, '')
  // Remove gate HTML block
  .replace(/<div id="gate">[\s\S]*?<\/div>\n<\/div>\n/, '')
  // Remove gate JS
  .replace(/var DEMO_ACCESS='[^']*';\n/, '')
  .replace(/function checkCode\(\)\{[\s\S]*?^\}\n/m, '')
  .replace(/if\(sessionStorage\.getItem\('demo_auth'\)==='1'\)\{[^}]+\}\n/, '');

// ── Claude API integration ────────────────────────────────────────────────────
var CLAUDE_SYSTEM_PROMPT = "You are an expert IT Support Agent for this organisation. Your primary mission is to assist IT staff and end-users by retrieving accurate, step-by-step information from the internal IT Knowledge Base and Operational Runbooks.\n\nFor ANY IT question, ALWAYS call search_kb first. If it returns file results, call read_file on the top result and base your answer on that content.\n\nEvery response MUST follow this exact format:\n[HIGH CONFIDENCE] or [MEDIUM CONFIDENCE] or [LOW CONFIDENCE]\nArticle ID: KB-XXX or RB-XXX | Category: [Category] | Severity: [Low/Medium/High/Critical]\n\nSummary: One sentence describing what this response covers.\n\nThen provide the full step-by-step procedure with:\n- Numbered steps for sequential procedures\n- Checkboxes [ ] for diagnostic checks\n- Phase headings for multi-phase tasks\n- Callouts: NOTE, WARNING, EXPECTED RESULT, TIP\n\nEvery response must end with:\nSource: [Article ID] - [Article Title]\n\nIf no KB article found, use [LOW CONFIDENCE] and Source: General IT best practice (no KB article found).\n\nEscalation contacts:\n- Security incidents: IT Security hotline ext. 9999 (24/7)\n- Standard failures: IT Service Desk ext. 1234 or https://itportal.yourorg.com\n\nEMAIL INSTRUCTIONS:\n- When the user asks to email anything, ALWAYS use the send_email tool immediately.\n- Default recipient: manueltucker@gmail.com (use this unless told otherwise)\n- Always send as HTML (is_html: true) for rich formatting\n- Format emailed documents with proper HTML: headings, numbered lists, checkboxes as unicode, tables for escalation paths\n- When emailing a KB article or procedure, include the FULL content — all phases, all steps, all callouts\n- Confirm to the user after sending: 'Email sent to manueltucker@gmail.com'\n\nWORKFLOW INSTRUCTIONS:\n- When the user asks to create a workflow, checklist, or job card, use the create_workflow tool\n- Detect task type: cisco_phone for Cisco phone installs, autopilot for new device setup, printer for printer setup, network for network config\n- Always confirm the OneNote link after creation so the tech can open it on mobile";

var CLAUDE_TOOLS_API = [
  {name:"search_kb",description:"Search IT Knowledge Base for scripts, runbooks, FAQs, assets, cabling, or troubleshooting guides. ALWAYS call this first for any IT question.",input_schema:{type:"object",properties:{query:{type:"string",description:"Search query"}},required:["query"]}},
  {name:"read_file",description:"Read the full contents of a KB article file. Call this after search_kb returns results to get the full article content.",input_schema:{type:"object",properties:{drive_id:{type:"string"},item_id:{type:"string"}},required:["drive_id","item_id"]}},
  {name:"list_library",description:"List all files in a specific KB library: Runbooks, FAQs, Troubleshooting, Assets, Scripts, or Cabling.",input_schema:{type:"object",properties:{library:{type:"string"}},required:["library"]}},
  {name:"ms_service_health",description:"Check live Microsoft 365 service health and active outages.",input_schema:{type:"object",properties:{service:{type:"string"}}}},
  {name:"ms_maintenance",description:"Get upcoming Microsoft 365 planned maintenance.",input_schema:{type:"object",properties:{}}},
  {name:"get_user",description:"Get Azure AD user profile by email or object ID.",input_schema:{type:"object",properties:{user_id:{type:"string"}},required:["user_id"]}},
  {name:"search_users",description:"Search Azure AD users by name or email.",input_schema:{type:"object",properties:{query:{type:"string"},limit:{type:"number"}},required:["query"]}},
  {name:"get_noncompliant_devices",description:"List non-compliant devices from Intune.",input_schema:{type:"object",properties:{platform:{type:"string"}}}},
  {name:"get_sign_in_logs",description:"Get recent Azure AD sign-in logs for a user.",input_schema:{type:"object",properties:{user_id:{type:"string"},limit:{type:"number"}}}},
  {name:"cisco_advisories",description:"Search Cisco PSIRT security advisories by product.",input_schema:{type:"object",properties:{product:{type:"string"}},required:["product"]}},
  {name:"web_search",description:"Search the web for IT information when KB has no results.",input_schema:{type:"object",properties:{query:{type:"string"}},required:["query"]}},
  {name:"send_email",description:"Send an email with IT guidance, documents, checklists or reports. Default recipient is manueltucker@gmail.com unless specified otherwise. Always use is_html:true for rich formatting. Send full article content when emailing KB articles.",input_schema:{type:"object",properties:{to:{type:"string",description:"Recipient email — default: manueltucker@gmail.com"},subject:{type:"string",description:"Email subject"},body:{type:"string",description:"Full HTML email body with all content"},is_html:{type:"boolean",description:"Always set to true"}},required:["to","subject","body"]}},
  {name:"create_workflow",description:"Create a step-by-step IT workflow checklist in OneNote for a field tech. Use for: Cisco phone installs (cisco_phone), Autopilot deployments (autopilot), printer setup (printer), network config (network). Returns a OneNote link the tech can open on mobile.",input_schema:{type:"object",properties:{title:{type:"string",description:"Workflow title e.g. Cisco Phone Install - Site A"},task_type:{type:"string",description:"One of: cisco_phone, autopilot, printer, network, custom"},tech_name:{type:"string",description:"Field tech name"},site:{type:"string",description:"Site or location name"},notes:{type:"string",description:"Any special instructions"}},required:["title","task_type"]}},
  {name:"create_list_workflow",description:"Create an interactive IT workflow checklist in Microsoft Lists. Field tech can tick off steps on mobile via Teams Lists tab. Use this for Cisco phone installs, Autopilot deployments, or any field job. Posts the checklist link to the Teams IT channel automatically.",input_schema:{type:"object",properties:{title:{type:"string",description:"Checklist title e.g. Cisco Phone Install - Site A - Tech Name"},task_type:{type:"string",description:"One of: cisco_phone, autopilot, printer, network, custom"},tech_name:{type:"string",description:"Name of the field tech assigned"},site:{type:"string",description:"Site or location name"},steps:{type:"array",items:{type:"string"},description:"Custom steps — leave empty to use the built-in template for the task_type"}},required:["title","task_type"]}}
];

function callAnthropicAPI(messages) {
  var body = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: CLAUDE_SYSTEM_PROMPT,
    tools: CLAUDE_TOOLS_API,
    messages: messages
  });
  return new Promise(function(resolve, reject) {
    var r = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      }
    }, function(response) {
      var d = "";
      response.on("data", function(c) { d += c; });
      response.on("end", function() {
        try { resolve(JSON.parse(d)); } catch(e) { reject(new Error("API parse error: " + d.substring(0,200))); }
      });
    });
    r.on("error", reject);
    r.write(body);
    r.end();
  });
}

function handleClaudeChat(userMessage) {
  var messages = [{role:"user", content: userMessage}];
  var startTime = Date.now();
  function loop(iterations) {
    if (iterations > 4) return Promise.resolve("[LOW CONFIDENCE]\nArticle ID: N/A | Category: General IT | Severity: Low\n\nI searched the knowledge base but could not find a specific article for this query. Please raise a ticket at https://itportal.yourorg.com or call ext. 1234.\n\nSource: General IT best practice (no KB article found)");
    if (Date.now() - startTime > 55000) return Promise.resolve("[LOW CONFIDENCE]\nArticle ID: N/A | Category: General IT | Severity: Low\n\nRequest timed out while searching. Please try a shorter question or raise a ticket at https://itportal.yourorg.com\n\nSource: General IT best practice");
    return callAnthropicAPI(messages).then(function(response) {
      if (response.error) return Promise.resolve("API error: " + (response.error.message||JSON.stringify(response.error)));
      if (response.stop_reason === "end_turn") {
        var textBlock = (response.content||[]).find(function(c){return c.type==="text";});
        return Promise.resolve(textBlock ? textBlock.text : "No response generated.");
      }
      if (response.stop_reason === "tool_use") {
        messages.push({role:"assistant", content: response.content});
        var toolUses = (response.content||[]).filter(function(c){return c.type==="tool_use";});
        return Promise.all(toolUses.map(function(toolUse) {
          return handleTool(toolUse.name, toolUse.input).then(function(result) {
            return {
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: (result.content&&result.content[0]&&result.content[0].text)||"No result"
            };
          }).catch(function(e) {
            return {type:"tool_result", tool_use_id:toolUse.id, content:"Tool error: "+e.message};
          });
        })).then(function(toolResults) {
          messages.push({role:"user", content: toolResults});
          return loop(iterations + 1);
        });
      }
      var textBlock2 = (response.content||[]).find(function(c){return c.type==="text";});
      return Promise.resolve(textBlock2 ? textBlock2.text : "Unexpected response from API.");
    });
  }
  return loop(0);
}

// ── Teams Bot integration ─────────────────────────────────────────────────────
// Set BOT_APP_ID and BOT_APP_PASSWORD as Azure Container Apps env vars after
// registering an Azure Bot (portal.azure.com → Create resource → Azure Bot).
// Set the bot messaging endpoint to:
//   https://<your-app>.azurecontainerapps.io/api/messages
// Then enable the Microsoft Teams channel in the bot configuration.

var BOT_APP_ID       = process.env.BOT_APP_ID       || "";
var BOT_APP_PASSWORD = process.env.BOT_APP_PASSWORD  || "";
var botToken = null, botTokenExpiry = 0;

function getBotToken() {
  if (botToken && Date.now() < botTokenExpiry) return Promise.resolve(botToken);
  var b = "grant_type=client_credentials"
    + "&client_id="     + encodeURIComponent(BOT_APP_ID)
    + "&client_secret=" + encodeURIComponent(BOT_APP_PASSWORD)
    + "&scope="         + encodeURIComponent("https://api.botframework.com/.default");
  return req({
    hostname: "login.microsoftonline.com",
    path:     "/botframework.com/oauth2/v2.0/token",
    method:   "POST",
    headers:  { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(b) }
  }, b).then(function(r) {
    botToken       = r.body.access_token;
    botTokenExpiry = Date.now() + ((r.body.expires_in || 3600) - 60) * 1000;
    return botToken;
  });
}

// Send a reply back into the Teams conversation via Bot Framework connector
function sendBotReply(serviceUrl, conversationId, replyToId, replyText) {
  return getBotToken().then(function(token) {
    var payload = JSON.stringify({
      type:      "message",
      text:      replyText,
      textFormat:"plain"
    });
    var u    = new URL(serviceUrl.replace(/\/$/, ""));
    var path = "/v3/conversations/" + encodeURIComponent(conversationId)
             + "/activities/" + encodeURIComponent(replyToId);
    return new Promise(function(resolve) {
      var d = Buffer.from(payload, "utf8");
      var r = https.request({
        hostname: u.hostname,
        path:     path,
        method:   "POST",
        headers:  {
          Authorization:   "Bearer " + token,
          "Content-Type":  "application/json",
          "Content-Length": d.length
        }
      }, function(re) {
        var s = ""; re.on("data", function(c) { s += c; }); re.on("end", function() { resolve(s); });
      });
      r.on("error", function(e) { resolve("error: " + e.message); });
      r.write(d);
      r.end();
    });
  }).catch(function(e) { return "getBotToken error: " + e.message; });
}

// Handle an incoming Bot Framework activity (called from /api/messages)
function handleBotActivity(activity) {
  // Only respond to message activities
  if (!activity || activity.type !== "message") return Promise.resolve();
  var text        = (activity.text || "").trim();
  var serviceUrl  = activity.serviceUrl || "";
  var convId      = activity.conversation && activity.conversation.id;
  var replyToId   = activity.id;

  if (!text || !serviceUrl || !convId) return Promise.resolve();

  // Route through the Claude agentic loop (same as the web chat)
  return handleClaudeChat(text).then(function(response) {
    return sendBotReply(serviceUrl, convId, replyToId, response);
  }).catch(function(e) {
    return sendBotReply(serviceUrl, convId, replyToId,
      "[LOW CONFIDENCE]\nArticle ID: N/A | Category: General IT | Severity: Low\n\n" +
      "Sorry, I ran into an error processing your request: " + e.message +
      "\n\nSource: General IT best practice");
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(function(reqHttp, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (reqHttp.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  var path = (new URL(reqHttp.url, "http://localhost")).pathname;

  if (path === "/sse" && reqHttp.method === "GET") { handleSSE(reqHttp, res); return; }
  if (path === "/message" && reqHttp.method === "POST") { handleMessage(reqHttp, res); return; }

  // ── Stub OAuth 2.1 endpoints so mcp-remote's mandatory auth flow succeeds ──
  // mcp-remote (the npm bridge Claude Desktop spawns) always runs OAuth before
  // opening the SSE stream. There is no CLI flag to skip it. So we implement
  // the four endpoints it walks through, and hand back API_KEY from /token so
  // the bridge's cached access_token is exactly the bearer our /sse + /message
  // handlers already accept.
  //
  //   GET  /.well-known/oauth-authorization-server  RFC 8414 AS metadata
  //   POST /register                                RFC 7591 dynamic client reg
  //   GET  /authorize                               302 back with ?code=...&state=...
  //   POST /token                                   { access_token: API_KEY, ... }
  //
  // PKCE parameters (code_challenge / code_verifier) are accepted and ignored —
  // we don't need real crypto because the issued access_token is always API_KEY.
  var BASE = "https://" + (reqHttp.headers.host || "claude-it-agent.whitestone-6cbe99bc.eastus.azurecontainerapps.io");

  if (path === "/.well-known/oauth-authorization-server" && reqHttp.method === "GET") {
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({
      issuer: BASE,
      authorization_endpoint: BASE + "/authorize",
      token_endpoint: BASE + "/token",
      registration_endpoint: BASE + "/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code","refresh_token"],
      code_challenge_methods_supported: ["S256","plain"],
      token_endpoint_auth_methods_supported: ["none","client_secret_basic","client_secret_post"],
      scopes_supported: ["mcp","offline_access"]
    }));
    return;
  }

  if (path === "/register" && reqHttp.method === "POST") {
    var regBody = "";
    reqHttp.on("data", function(c) { regBody += c; });
    reqHttp.on("end", function() {
      var parsed = {};
      try { parsed = JSON.parse(regBody || "{}"); } catch(e) { parsed = {}; }
      res.writeHead(201, {"Content-Type":"application/json"});
      res.end(JSON.stringify({
        client_id: "mcp-remote-stub",
        client_secret: "not-used",
        client_id_issued_at: Math.floor(Date.now()/1000),
        client_secret_expires_at: 0,
        redirect_uris: parsed.redirect_uris || ["http://localhost/callback"],
        client_name: parsed.client_name || "MCP CLI Proxy",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code","refresh_token"],
        response_types: ["code"]
      }));
    });
    return;
  }

  if (path === "/authorize" && reqHttp.method === "GET") {
    var qs = (new URL(reqHttp.url, "http://localhost")).searchParams;
    var redirectUri = qs.get("redirect_uri");
    var state = qs.get("state") || "";
    if (!redirectUri) {
      res.writeHead(400, {"Content-Type":"application/json"});
      res.end(JSON.stringify({error:"invalid_request",error_description:"redirect_uri required"}));
      return;
    }
    var sep = redirectUri.indexOf("?") >= 0 ? "&" : "?";
    var location = redirectUri + sep + "code=mcp-remote-stub-code" +
                   (state ? "&state=" + encodeURIComponent(state) : "");
    res.writeHead(302, {"Location": location});
    res.end();
    return;
  }

  if (path === "/token" && reqHttp.method === "POST") {
    var tokBody = "";
    reqHttp.on("data", function(c) { tokBody += c; });
    reqHttp.on("end", function() {
      // Accept any grant_type / code / verifier; we always hand back API_KEY
      // so the bridge's downstream requests match the bearer our /sse accepts.
      res.writeHead(200, {"Content-Type":"application/json","Cache-Control":"no-store"});
      res.end(JSON.stringify({
        access_token: API_KEY,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "mcp-remote-stub-refresh",
        scope: "mcp"
      }));
    });
    return;
  }

  // ── Teams Bot Framework endpoint ──────────────────────────────────────────
  // Azure Bot Service posts all incoming Teams messages here.
  // Register BOT_APP_ID + BOT_APP_PASSWORD env vars to enable.
  if (path === "/api/messages" && reqHttp.method === "POST") {
    var botBody = "";
    reqHttp.on("data", function(c) { botBody += c; });
    reqHttp.on("end", function() {
      // Acknowledge immediately (Bot Framework requires fast 200)
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
      // Process activity asynchronously
      try {
        var activity = JSON.parse(botBody);
        // Only process if bot credentials are configured
        if (!BOT_APP_ID || !BOT_APP_PASSWORD) {
          console.log("[Bot] /api/messages received but BOT_APP_ID/BOT_APP_PASSWORD not set.");
          return;
        }
        handleBotActivity(activity).catch(function(e) {
          console.error("[Bot] handleBotActivity error:", e.message);
        });
      } catch(e) {
        console.error("[Bot] JSON parse error:", e.message);
      }
    });
    return;
  }

  // ── Web Chat UI ──────────────────────────────────────────────────────────
  // /chat  — no gate, bookmark this on your phone for instant access
  // /demo  — gate-protected, share this link for external demos
  if (path === "/chat" && reqHttp.method === "GET") {
    res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
    res.end(CHAT_HTML);
    return;
  }
  if (path === "/demo" && reqHttp.method === "GET") {
    res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
    res.end(DEMO_HTML);
    return;
  }
  if ((path === "/chat" || path === "/demo") && reqHttp.method === "POST") {
    var chatBody = "";
    reqHttp.on("data", function(c) { chatBody += c; });
    reqHttp.on("end", function() {
      try {
        var parsed = JSON.parse(chatBody);
        var message = parsed.message || "";
        if (!message.trim()) {
          res.writeHead(400, {"Content-Type":"application/json"});
          res.end(JSON.stringify({error:"Empty message"}));
          return;
        }

        // ── Claude API integration ────────────────────────────────────────────
        if (process.env.ANTHROPIC_API_KEY) {
          handleClaudeChat(message).then(function(response) {
            res.writeHead(200, {"Content-Type":"application/json"});
            res.end(JSON.stringify({response: response}));
          }).catch(function(e) {
            res.writeHead(200, {"Content-Type":"application/json"});
            res.end(JSON.stringify({response: "Sorry, I ran into an error: " + e.message}));
          });
          return;
        }

        var route = routeChat(message);
        // Detect vendor from message for dual-source lookup
        var msgLower = message.toLowerCase();
        var detectedVendor = msgLower.includes("fujitsu")||msgLower.includes("scansnap")||msgLower.includes("fi-")?"fujitsu":
          msgLower.includes("cisco")||msgLower.includes("catalyst")||msgLower.includes("anyconnect")?"cisco":
          msgLower.includes("dell")||msgLower.includes("optiplex")||msgLower.includes("latitude")||msgLower.includes("idrac")?"dell":
          msgLower.includes("hp ")||msgLower.includes("laserjet")||msgLower.includes("elitebook")||msgLower.includes("hewlett")?"hp":
          msgLower.includes("logitech")||msgLower.includes("logi")||msgLower.includes("mx keys")||msgLower.includes("mx master")||msgLower.includes("unifying")?"logitech":
          msgLower.includes("microsoft mouse")||msgLower.includes("microsoft keyboard")||msgLower.includes("surface keyboard")||msgLower.includes("arc mouse")||msgLower.includes("sculpt")?"microsoft":
          msgLower.includes("apple")||msgLower.includes("macbook")||msgLower.includes("iphone")||msgLower.includes("ipad")||msgLower.includes("macos")?"apple":null;

        // ── Smart article processor ──────────────────────────────────────────
        function processArticle(articleText, question) {
          var q = (question||"").toLowerCase();
          var wantsScript = /script|powershell|command|cmd|terminal|bash|automat/i.test(q);
          var wantsGUI = /gui|interface|click|step.by.step|how do i|walk me|show me how/i.test(q);

          // Extract code blocks
          var codeBlocks = [];
          var codeRx = /```[\w]*\n?([\s\S]*?)```/g;
          var cm;
          while ((cm = codeRx.exec(articleText)) !== null && codeBlocks.length < 3) {
            if (cm[1].trim().length > 10) codeBlocks.push(cm[1].trim());
          }

          // Split into sections by markdown headers
          var sections = [];
          var curSection = {title:"", lines:[]};
          articleText.split("\n").forEach(function(line) {
            if (/^#{1,3}\s+/.test(line)) {
              if (curSection.lines.length) sections.push(curSection);
              curSection = {title: line.replace(/^#+\s+/,""), lines:[]};
            } else { curSection.lines.push(line); }
          });
          if (curSection.lines.length) sections.push(curSection);

          // Score sections by relevance to question keywords
          var keywords = q.replace(/[^\w\s]/g,"").split(/\s+/).filter(function(w){return w.length>3;});
          var scored = sections.map(function(s) {
            var txt = (s.title+" "+s.lines.join(" ")).toLowerCase();
            var score = keywords.reduce(function(a,kw){return a+(txt.includes(kw)?2:0);},0);
            // Bonus for sections with numbered steps
            if (/\d+\.\s+/.test(s.lines.join(" "))) score += 3;
            if (/(step|procedure|instruction|how to)/i.test(s.title)) score += 4;
            if (wantsScript && /(script|powershell|command|terminal|bash)/i.test(s.title)) score += 5;
            if (wantsGUI && /(gui|interface|portal|console|click|navigate)/i.test(s.title)) score += 5;
            return {s:s, score:score};
          }).sort(function(a,b){return b.score-a.score;});

          var response = "";

          // Script mode — lead with code
          if (wantsScript && codeBlocks.length > 0) {
            response += "💻 Script / Command Line:\n\n";
            codeBlocks.slice(0,2).forEach(function(c,i){
              response += (i>0?"---\n":"")+c+"\n\n";
            });
          }

          // Add top relevant sections as step-by-step
          var added = 0;
          scored.slice(0, wantsScript?2:4).forEach(function(item) {
            if (added >= 3) return;
            var s = item.s;
            var content = s.lines.join("\n")
              .replace(/\*\*(.*?)\*\*/g,"$1")
              .replace(/`([^`\n]+)`/g,"$1")
              .replace(/^>\s*/gm,"")
              .replace(/\[([^\]]+)\]\([^)]+\)/g,"$1")
              .trim();
            if (!content || content.length < 30) return;
            if (s.title) response += "\n📌 "+s.title+"\n";
            response += content.substring(0,900)+"\n";
            added++;
          });

          // If GUI mode and no script shown yet, append a script option at end
          if (!wantsScript && codeBlocks.length > 0) {
            response += "\n\n💻 Script alternative:\n"+codeBlocks[0].substring(0,600);
          }

          return response.trim().substring(0,3500) + (response.length>3500 ? "\n\n[Reply 'continue' for more details]" : "");
        }

        // ── Detect workflow type for OneNote auto-creation ───────────────────
        var workflowType = null;
        var workflowTitle = null;
        if (/cisco.*(phone|ip phone|7800|8800|8900)|phone.*(install|setup|deploy)/i.test(message)) {
          workflowType = "cisco_phone";
          workflowTitle = "Cisco Phone Install — " + new Date().toLocaleDateString("en-GB");
        } else if (/autopilot|new.*(laptop|computer|device|pc)|enroll.*device|deploy.*computer/i.test(message)) {
          workflowType = "autopilot";
          workflowTitle = "Autopilot Deployment — " + new Date().toLocaleDateString("en-GB");
        } else if (/printer.*(setup|install|config)|install.*printer/i.test(message)) {
          workflowType = "printer";
          workflowTitle = "Printer Setup — " + new Date().toLocaleDateString("en-GB");
        } else if (/network.*(config|setup)|switch.*(config|setup|port)|wifi.*(setup|config)/i.test(message)) {
          workflowType = "network";
          workflowTitle = "Network Configuration — " + new Date().toLocaleDateString("en-GB");
        }

        // ── OneNote workflow creator ─────────────────────────────────────────
        var ONENOTE_USER = "manueltucker@claudeitagent.onmicrosoft.com";
        var ONENOTE_NOTEBOOK = "IT Workflows";
        var SECTION_MAP = {cisco_phone:"Cisco Phone Installs",autopilot:"Autopilot Deployments",network:"Network Configuration",printer:"Printer Setup",custom:"Custom Workflows"};
        var WORKFLOW_TEMPLATES = {
          cisco_phone:[
            {heading:"Pre-Installation Checks",items:["Unbox phone and verify model against work order","Confirm MAC address matches deployment sheet","Check PoE switch port is active and tagged to voice VLAN","Verify DHCP scope has available IPs for voice VLAN","Confirm CUCM device profile is ready for this MAC"]},
            {heading:"Physical Installation",items:["Mount bracket and place phone","Connect ethernet cable to PoE switch port","Connect handset and headset if required","Power on and confirm boot screen appears","Note the IP address displayed during boot"]},
            {heading:"Phone Registration",items:["Confirm phone registers in CUCM","Verify correct extension (DN) is assigned","Test internal call — confirm audio both ways","Test external call via PSTN","Confirm voicemail button routes correctly"]},
            {heading:"Configuration",items:["Set correct time zone and date/time","Configure speed dials as requested","Test intercom and call pickup group","Verify BLF keys if applicable","Label phone with extension and user name"]},
            {heading:"Sign-Off",items:["User confirmed phone is working","Photo taken of installation","Work order updated with MAC, IP, extension, location","Post completion to Teams IT channel"]}
          ],
          autopilot:[
            {heading:"Pre-Deployment Checks",items:["Confirm serial number is registered in Autopilot","Verify Autopilot profile is assigned","Confirm user M365 licence is active","Check Wi-Fi or ethernet available on site","Confirm user MFA is configured"]},
            {heading:"Hardware Setup",items:["Unbox and connect to power","Connect ethernet if Wi-Fi not available","Power on and wait for OOBE screen","Select region and keyboard layout","Confirm network connection shown"]},
            {heading:"Autopilot Enrollment",items:["Enter user corporate email address","Wait for Autopilot profile to download","Confirm organisation branding appears","Complete MFA when prompted","Do NOT interrupt — wait for policies to apply"]},
            {heading:"Verification",items:["Confirm OneDrive sync starts automatically","Open Outlook and confirm mailbox loads","Open Teams and confirm correct account","Connect VPN and confirm it works","Check Intune compliance shows Compliant"]},
            {heading:"Sign-Off",items:["User confirmed device is working","Intune shows Compliant","Device name recorded in work order","Old device collected if applicable","Post completion to Teams IT channel"]}
          ]
        };

        function createOnenoteWorkflow(wfType, wfTitle) {
          var sectionName = SECTION_MAP[wfType] || "Custom Workflows";
          var steps = WORKFLOW_TEMPLATES[wfType] || [{heading:"Steps",items:["Complete task steps here"]}];
          var dateStr = new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
          var html = "<!DOCTYPE html><html><head><title>"+wfTitle+"</title></head><body>";
          html += "<h1>"+wfTitle+"</h1>";
          html += "<p><b>Date:</b> "+dateStr+" | <b>Status:</b> In Progress</p><hr/>";
          steps.forEach(function(s){
            html += "<h2>"+s.heading+"</h2>";
            (s.items||[]).forEach(function(item){ html += "<p data-tag=\"to-do\">"+item+"</p>"; });
          });
          html += "<h2>Job Complete</h2>";
          html += "<p data-tag=\"to-do\">All steps completed and verified</p>";
          html += "<p data-tag=\"to-do\">Post completion message to Teams IT channel</p>";
          html += "</body></html>";

          // Ensure notebook exists
          return getGraphToken().then(function(t){
            return req({hostname:"graph.microsoft.com",path:"/v1.0/users/"+encodeURIComponent(ONENOTE_USER)+"/onenote/notebooks",method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}});
          }).then(function(r){
            var nb=(r.body.value||[]).find(function(n){return n.displayName===ONENOTE_NOTEBOOK;});
            if(nb) return nb.id;
            return getGraphToken().then(function(t){
              var b=JSON.stringify({displayName:ONENOTE_NOTEBOOK});
              return req({hostname:"graph.microsoft.com",path:"/v1.0/users/"+encodeURIComponent(ONENOTE_USER)+"/onenote/notebooks",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)}},b);
            }).then(function(r){return r.body.id;});
          }).then(function(nbId){
            // Ensure section exists
            return getGraphToken().then(function(t){
              return req({hostname:"graph.microsoft.com",path:"/v1.0/users/"+encodeURIComponent(ONENOTE_USER)+"/onenote/notebooks/"+nbId+"/sections",method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}});
            }).then(function(r){
              var sec=(r.body.value||[]).find(function(s){return s.displayName===sectionName;});
              if(sec) return sec.id;
              return getGraphToken().then(function(t){
                var b=JSON.stringify({displayName:sectionName});
                return req({hostname:"graph.microsoft.com",path:"/v1.0/users/"+encodeURIComponent(ONENOTE_USER)+"/onenote/notebooks/"+nbId+"/sections",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)}},b);
              }).then(function(r){return r.body.id;});
            });
          }).then(function(secId){
            return getGraphToken().then(function(t){
              var pageData=Buffer.from(html,"utf8");
              return new Promise(function(resolve,reject){
                var r=https.request({hostname:"graph.microsoft.com",path:"/v1.0/users/"+encodeURIComponent(ONENOTE_USER)+"/onenote/sections/"+secId+"/pages",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/xhtml+xml","Content-Length":pageData.length}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{resolve({status:re.statusCode,body:JSON.parse(d)});}catch(e){resolve({status:re.statusCode,body:d});}});});
                r.on("error",reject);r.write(pageData);r.end();
              });
            }).then(function(r){
              if(r.status===201||r.status===200){
                return (r.body.links&&r.body.links.oneNoteWebUrl&&r.body.links.oneNoteWebUrl.href)||"";
              }
              return "";
            });
          }).catch(function(){return "";});
        }

        // ── Focused search term for vendor queries ───────────────────────────
        var focusedSearchTerm = message;
        if (detectedVendor === "logitech") focusedSearchTerm = "logitech " + (msgLower.includes("bluetooth")?"bluetooth pairing":msgLower.includes("unifying")?"unifying receiver":msgLower.includes("driver")?"driver download windows":msgLower.includes("not working")?"troubleshooting":"setup windows");
        else if (detectedVendor === "microsoft") focusedSearchTerm = "microsoft " + (msgLower.includes("bluetooth")?"bluetooth keyboard mouse pairing windows":msgLower.includes("driver")?"peripheral driver update":"wireless keyboard mouse troubleshooting");
        else if (detectedVendor === "fujitsu") focusedSearchTerm = "fujitsu scansnap driver windows";
        else if (detectedVendor === "cisco") {
          if (msgLower.includes("anyconnect")||msgLower.includes("vpn")) focusedSearchTerm = "cisco anyconnect vpn";
          else if (workflowType === "cisco_phone" || msgLower.includes("phone")) focusedSearchTerm = "RB-010 cisco phone installation";
          else focusedSearchTerm = "cisco switch troubleshooting";
        }
        else if (detectedVendor === "dell") focusedSearchTerm = "dell " + (msgLower.includes("boot")?"boot troubleshooting":"hardware diagnostics");
        else if (detectedVendor === "hp") focusedSearchTerm = "hp " + (msgLower.includes("print")?"printer setup":"hardware support");
        // Workflow queries — search directly in Runbooks by article ID
        if (workflowType === "cisco_phone") focusedSearchTerm = "RB-010 cisco phone installation";
        if (workflowType === "autopilot") focusedSearchTerm = "RB-011 autopilot deployment";

        // ── Build and send final response with optional OneNote link ─────────
        function sendResponse(text, confidence) {
          var conf = confidence || "HIGH";
          var onenotePromise = workflowType
            ? createOnenoteWorkflow(workflowType, workflowTitle)
            : Promise.resolve("");

          onenotePromise.then(function(oneNoteUrl) {
            var finalResponse = "[" + conf + " CONFIDENCE]\n" + text;
            if (oneNoteUrl) {
              finalResponse += "\n\n---\n📋 OneNote Workflow Created\nA step-by-step checklist has been created for your field tech:\n" + oneNoteUrl + "\nShare this link with the tech — they can tick each step on their phone as they go.";
            }
            res.writeHead(200, {"Content-Type":"application/json"});
            res.end(JSON.stringify({response: finalResponse}));
          }).catch(function() {
            res.writeHead(200, {"Content-Type":"application/json"});
            res.end(JSON.stringify({response: "[" + conf + " CONFIDENCE]\n" + text}));
          });
        }

        function readAndRespond(files, confidence) {
          var topFiles = files.slice(0,2).filter(function(f){return f.driveId&&f.id;});
          if (!topFiles.length) return null;
          return Promise.all(topFiles.map(function(f){
            return handleTool("read_file",{drive_id:f.driveId,item_id:f.id}).then(function(r){
              return {name:f.name, text:r.content&&r.content[0]&&r.content[0].text||""};
            });
          })).then(function(articles) {
            var combined = articles.map(function(a){return a.text;}).join("\n\n---\n\n");
            var processed = processArticle(combined, message);
            var firstName = articles[0].name || "";
            var articleIdMatch = firstName.match(/^(kb|rb)-?(\d+)/i);
            var articleId = articleIdMatch ? articleIdMatch[1].toUpperCase()+"-"+articleIdMatch[2].padStart(3,"0") : "KB";
            var articleTitle = firstName.replace(/\.md$/i,"").replace(/^(kb|rb)-?\d+-?/i,"").replace(/-/g," ").replace(/\b\w/g,function(c){return c.toUpperCase();});
            var contentLower = combined.toLowerCase();
            var category = contentLower.includes("password")||contentLower.includes("account")?"Account Access":
              contentLower.includes("vpn")||contentLower.includes("wifi")||contentLower.includes("network")?"Network & Connectivity":
              contentLower.includes("hardware")||contentLower.includes("laptop")||contentLower.includes("device")?"Hardware":
              contentLower.includes("software")||contentLower.includes("install")||contentLower.includes("portal")?"Software & Applications":
              contentLower.includes("outlook")||contentLower.includes("email")?"Email & Communication":
              contentLower.includes("phish")||contentLower.includes("ransomware")||contentLower.includes("security")?"Security":
              contentLower.includes("print")?"Printing":"IT Operations";
            var severity = contentLower.includes("critical")||contentLower.includes("ransomware")||contentLower.includes("phish")?"Critical":
              contentLower.includes("warning")||contentLower.includes("urgent")?"High":"Low";

            var text = "Article ID: "+articleId+" | Category: "+category+" | Severity: "+severity+"\n\n";
            text += processed;
            text += "\n\nSource: "+articleId+" — "+articleTitle;
            sendResponse(text, confidence||"HIGH");
          });
        }

        handleTool(route.tool, route.args).then(function(result) {
          var rawText = result.content && result.content[0] && result.content[0].text || "";

          // KB returned file list — read immediately
          if (route.tool === "search_kb" && rawText.startsWith("[")) {
            try {
              var files = JSON.parse(rawText);
              if (files.length > 0) return readAndRespond(files, "HIGH");
            } catch(e) {}
          }

          // KB auto-synced from Learn OR vendor detected — sync vendor docs then re-search with focused terms
          if (route.tool === "search_kb" && (rawText.includes("Auto-synced") || rawText.includes("No results"))) {
            var vendorSync = detectedVendor
              ? handleTool("sync_vendor_docs", {vendor:detectedVendor, topic:focusedSearchTerm, library:"Troubleshooting", max_articles:3})
              : Promise.resolve(null);
            return vendorSync.then(function() {
              // Search with focused term first, then fall back to original message
              return handleTool("search_kb", {query: focusedSearchTerm});
            }).then(function(r2) {
              var t2 = r2.content && r2.content[0] && r2.content[0].text || "";
              if (t2.startsWith("[")) {
                try {
                  var files2 = JSON.parse(t2);
                  if (files2.length > 0) return readAndRespond(files2, rawText.includes("Auto-synced") ? "MEDIUM" : "HIGH");
                } catch(e) {}
              }
              // Try original message as fallback search
              return handleTool("search_kb", {query: message}).then(function(r3) {
                var t3 = r3.content && r3.content[0] && r3.content[0].text || "";
                if (t3.startsWith("[")) {
                  try {
                    var files3 = JSON.parse(t3);
                    if (files3.length > 0) return readAndRespond(files3, "MEDIUM");
                  } catch(e) {}
                }
                // Final fallback — nothing found anywhere
                var text = "Article ID: N/A | Category: " + (detectedVendor ? detectedVendor.toUpperCase()+" Hardware" : "General IT") + " | Severity: Low\n\n";
                text += "I could not find a specific KB article for this topic.\n\n";
                if (detectedVendor) {
                  text += "📝 NOTE: I searched the KB and " + detectedVendor.toUpperCase() + " support documentation but could not find a direct match for: " + message + "\n\n";
                  text += "Steps to resolve:\n";
                  text += "1. Visit the manufacturer support site directly\n";
                  text += "2. Search for your exact model number and Windows version\n";
                  text += "3. Download the latest driver from the official site\n\n";
                }
                text += "Escalation: Raise a ticket at https://itportal.yourorg.com or call ext. 1234\n\n";
                text += "Source: General IT best practice (no KB article found)";
                sendResponse(text, "LOW");
              });
            });
          }

          var response = formatChatResponse(route.tool, rawText);
          res.writeHead(200, {"Content-Type":"application/json"});
          res.end(JSON.stringify({response: response}));
        }).catch(function(e) {
          res.writeHead(200, {"Content-Type":"application/json"});
          res.end(JSON.stringify({response: "Sorry, I ran into an error: " + e.message}));
        });
      } catch(e) {
        res.writeHead(400, {"Content-Type":"application/json"});
        res.end(JSON.stringify({error:"Invalid JSON"}));
      }
    });
    return;
  }

  if (path === "/health") {
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({status:"healthy",version:"10.0.0",time:new Date().toISOString()}));
    return;
  }
  // Legacy REST endpoint
  if (path === "/query" && reqHttp.method === "POST") {
    var b = "";
    reqHttp.on("data", function(c) { b += c; });
    reqHttp.on("end", function() {
      try {
        var data = JSON.parse(b);
        handleTool(data.action || "search_kb", data.params || {}).then(function(result) {
          res.writeHead(200, {"Content-Type":"application/json"});
          res.end(JSON.stringify({success:true,result:result.content[0].text}));
        }).catch(function(e) {
          res.writeHead(500, {"Content-Type":"application/json"});
          res.end(JSON.stringify({success:false,error:e.message}));
        });
      } catch(e) {
        res.writeHead(400, {"Content-Type":"application/json"});
        res.end(JSON.stringify({success:false,error:"Invalid JSON"}));
      }
    });
    return;
  }
  // Root path returns the service banner (kept for humans/CLI pings).
  if (path === "/" || path === "") {
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({name:"IT Knowledge Agent",version:"8.0.0",status:"running",endpoints:["/sse","/message","/health","/query","/sync"]}));
    return;
  }
  // Everything else 404s. This matters for OAuth-aware MCP clients (mcp-remote),
  // which probe /.well-known/oauth-authorization-server, /register, /authorize,
  // /token etc. as part of RFC 8414 discovery + RFC 7591 dynamic client
  // registration. Previously those fell through to the catch-all and returned
  // service-info JSON with a 200, which mcp-remote's zod validators read as
  // malformed OAuth metadata / client-info and crashed the bridge
  // (ZodError: expected string client_id / expected array redirect_uris /
  //  expected string issuer / expected string authorization_endpoint). Returning
  // 404 causes the client to skip the OAuth flow and fall back to the static
  // Authorization: Bearer header, letting the SSE handshake complete.
  res.writeHead(404, {"Content-Type":"application/json"});
  res.end(JSON.stringify({error:"not_found",path:path}));
});

server.listen(PORT, function() {
  console.log("IT Knowledge Agent v10.0 running on port " + PORT);
console.log("Web chat UI: /chat");
  console.log("MCP SSE endpoint: /sse");
});
