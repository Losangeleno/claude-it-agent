/**


 * app.js â€” Claude IT Agent (Remote MCP Server)
 * Runs on Azure App Service. Exposes all IT Agent tools over
 * MCP SSE transport so Claude web, desktop, and mobile can connect.
 *
 * Endpoints:
 *   GET  /sse      â€” MCP SSE connection (Claude connects here)
 *   POST /message  â€” MCP message handler
 *   GET  /health   â€” Health check (Azure App Service probe)
 *   POST /query    â€” Legacy REST API (backward compat)
 */

"use strict";

const https  = require("https");
const http   = require("http");
const crypto = require("crypto");

// â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// API key â€” Claude sessions must send this as Bearer token
// Change this to something secret before deploying
const API_KEY = process.env.MCP_API_KEY || "claudeITAgent2026";

// â”€â”€ Vendor support site configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const VENDOR_SITES = {
  cisco:   { domain: "cisco.com",         searchPath: "/c/en/us/search/index.html?query=", label: "Cisco Support" },
  dell:    { domain: "dell.com",           searchPath: "/support/home/search?query=",       label: "Dell Support" },
  hp:      { domain: "support.hp.com",     searchPath: "/us-en/search#q=",                 label: "HP Support" },
  hpe:     { domain: "support.hpe.com",    searchPath: "/hpesc/public/api/document/",      label: "HPE Support" },
  fujitsu: { domain: "support.fujitsu.com",searchPath: "/sp/support/",                    label: "Fujitsu Support" },
  apple:   { domain: "support.apple.com",   searchPath: "/",                               label: "Apple Support" }
};

// Vendor-specific DDG search (site-scoped) â†’ parse top URLs â†’ fetch content
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
          // DDG wraps URLs â€” extract the actual URL
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

// â”€â”€ Microsoft Learn topic â†’ KB library mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Fetch and convert a Microsoft Learn article to markdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fetchLearnArticle(url) {
  return fetchPageText(url, 6000).then(function(text) {
    if (!text || text.length < 100) return null;
    // Clean up whitespace artifacts from HTML strip
    return text.replace(/\s{3,}/g, "\n\n").trim();
  });
}

// â”€â”€ Pull top Learn articles for a topic and upload to KB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Token caches â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let spToken=null,spExpiry=0,graphToken=null,graphExpiry=0;
let ciscoToken=null,ciscoExpiry=0,siteId=null,cachedDrives=[];

// â”€â”€ SSE sessions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const sessions = new Map(); // sessionId â†’ res (SSE response object)

// â”€â”€ Core HTTP helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function req(o,b){return new Promise(function(res,rej){var r=https.request(o,function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{res({status:re.statusCode,body:JSON.parse(d)});}catch(e){res({status:re.statusCode,body:d});}});});r.on("error",rej);if(b)r.write(b);r.end();});}

// â”€â”€ Token functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getSPToken(){if(spToken&&Date.now()<spExpiry)return Promise.resolve(spToken);var b="grant_type=client_credentials&client_id="+encodeURIComponent(CLIENT_ID)+"&client_secret="+encodeURIComponent(CLIENT_SECRET)+"&scope="+encodeURIComponent("https://graph.microsoft.com/.default");return req({hostname:"login.microsoftonline.com",path:"/"+TENANT_ID+"/oauth2/v2.0/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(b)}},b).then(function(r){spToken=r.body.access_token;spExpiry=Date.now()+(r.body.expires_in-60)*1000;return spToken;});}

function getGraphToken(){if(graphToken&&Date.now()<graphExpiry)return Promise.resolve(graphToken);var b="grant_type=client_credentials&client_id="+encodeURIComponent(GRAPH_CLIENT_ID)+"&client_secret="+encodeURIComponent(GRAPH_CLIENT_SECRET)+"&scope="+encodeURIComponent("https://graph.microsoft.com/.default");return req({hostname:"login.microsoftonline.com",path:"/"+TENANT_ID+"/oauth2/v2.0/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(b)}},b).then(function(r){graphToken=r.body.access_token;graphExpiry=Date.now()+(r.body.expires_in-60)*1000;return graphToken;});}

function getCiscoToken(){if(ciscoToken&&Date.now()<ciscoExpiry)return Promise.resolve(ciscoToken);var b="grant_type=client_credentials&client_id="+encodeURIComponent(CISCO_KEY)+"&client_secret="+encodeURIComponent(CISCO_SECRET);return req({hostname:"id.cisco.com",path:"/oauth2/default/v1/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(b)}},b).then(function(r){ciscoToken=r.body.access_token;ciscoExpiry=Date.now()+3500000;return ciscoToken;});}

// â”€â”€ Graph helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function graph(path){return getSPToken().then(function(t){return req({hostname:"graph.microsoft.com",path:"/v1.0"+path,method:"GET",headers:{Authorization:"Bearer "+t}});}).then(function(r){return r.body;});}

function graphGet(path){return getGraphToken().then(function(t){return req({hostname:"graph.microsoft.com",path:"/v1.0"+path,method:"GET",headers:{Authorization:"Bearer "+t}});}).then(function(r){return r.body;});}

function graphPost(path,body){var b=JSON.stringify(body);return getGraphToken().then(function(t){return req({hostname:"graph.microsoft.com",path:"/v1.0"+path,method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)}},b);}).then(function(r){return r.body;});}

function graphSearch(path,params){return getGraphToken().then(function(t){var qs=Object.entries(params||{}).map(function(e){return encodeURIComponent(e[0])+"="+encodeURIComponent(e[1]);}).join("&");return req({hostname:"graph.microsoft.com",path:"/v1.0"+path+(qs?"?"+qs:""),method:"GET",headers:{Authorization:"Bearer "+t,ConsistencyLevel:"eventual"}});}).then(function(r){return r.body;});}

function getSiteId(){if(siteId)return Promise.resolve(siteId);return graph("/sites/"+TENANT_NAME+".sharepoint.com:/sites/"+SITE_NAME+":").then(function(d){siteId=d.id;return siteId;});}

function getDrives(){if(cachedDrives.length)return Promise.resolve(cachedDrives);return getSiteId().then(function(id){return graph("/sites/"+id+"/drives");}).then(function(d){cachedDrives=d.value||[];return cachedDrives;});}

function fetchPageText(urlString,maxLen){maxLen=maxLen||2500;return new Promise(function(resolve){try{var u=new URL(urlString);if(u.protocol!=="https:"){resolve("");return;}var r=https.get({hostname:u.hostname,path:u.pathname+u.search,headers:{"User-Agent":"Mozilla/5.0","Accept":"text/html"}},function(res){if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){resolve(fetchPageText(res.headers.location,maxLen));return;}var data="";res.on("data",function(c){data+=c;if(data.length>150000)res.destroy();});res.on("end",function(){var text=data.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s{2,}/g," ").trim();resolve(text.substring(0,maxLen));});});r.on("error",function(){resolve("");});r.setTimeout(12000,function(){r.destroy();resolve("");});}catch(e){resolve("");}});}

// â”€â”€ Tools definition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // Phase 2 â€” Azure AD
  {name:"get_user",description:"Get an Azure AD user profile by email or object ID",inputSchema:{type:"object",properties:{user_id:{type:"string"}},required:["user_id"]}},
  {name:"search_users",description:"Search Azure AD users by name or email",inputSchema:{type:"object",properties:{query:{type:"string"},limit:{type:"number"}},required:["query"]}},
  {name:"get_user_groups",description:"Get all group memberships for an Azure AD user",inputSchema:{type:"object",properties:{user_id:{type:"string"}},required:["user_id"]}},
  {name:"list_devices",description:"List Azure AD / Intune-registered devices",inputSchema:{type:"object",properties:{filter:{type:"string"}}}},
  {name:"get_sign_in_logs",description:"Get recent Azure AD sign-in logs for a user",inputSchema:{type:"object",properties:{user_id:{type:"string"},limit:{type:"number"}}}},
  // Phase 1 â€” Teams
  {name:"list_teams",description:"List all Microsoft Teams in the organisation",inputSchema:{type:"object",properties:{}}},
  {name:"list_channels",description:"List all channels in a Microsoft Team",inputSchema:{type:"object",properties:{team_id:{type:"string"}},required:["team_id"]}},
  {name:"get_channel_messages",description:"Read recent messages from a Teams channel",inputSchema:{type:"object",properties:{team_id:{type:"string"},channel_id:{type:"string"},limit:{type:"number"}},required:["team_id","channel_id"]}},
  {name:"send_channel_message",description:"Post a message to the IT Agent Teams channel",inputSchema:{type:"object",properties:{message:{type:"string"},html:{type:"boolean"}},required:["message"]}},
  // Phase 3 â€” Microsoft Learn sync
  {name:"sync_learn_to_kb",description:"Search Microsoft Learn for a topic and save the top articles to the IT Knowledge Base. Automatically picks the right library (Troubleshooting, Runbooks, FAQs).",inputSchema:{type:"object",properties:{topic:{type:"string",description:"The IT topic to search, e.g. 'Windows 11 Event Viewer', 'BitLocker recovery', 'Intune device enrollment'"},library:{type:"string",description:"Override target library: Troubleshooting, Runbooks, FAQs, Assets, Cabling. Leave blank for auto-detect."},max_articles:{type:"number",description:"Number of articles to sync (1-5, default 3)"}},required:["topic"]}},
  {name:"sync_vendor_docs",description:"Pull support documentation from Cisco, Dell, HP/HPE, Fujitsu, or Apple and save to the IT Knowledge Base.",inputSchema:{type:"object",properties:{vendor:{type:"string",enum:["cisco","dell","hp","hpe","fujitsu","apple"],description:"The vendor to search"},topic:{type:"string",description:"The support topic"},library:{type:"string",description:"Target KB library: Troubleshooting, Runbooks, FAQs. Default: Troubleshooting"},max_articles:{type:"number",description:"Number of articles to pull (1-5, default 3)"}},required:["vendor","topic"]}},
  // Phase 4 â€” Intune / Device Management
  {name:"get_intune_devices",description:"List all devices enrolled in Microsoft Intune. Filter by platform (windows, ios, macos, android), user, or compliance state.",inputSchema:{type:"object",properties:{platform:{type:"string",description:"Filter by OS: windows, ios, macos, android. Leave blank for all."},user:{type:"string",description:"Filter by user email or display name"},compliance:{type:"string",enum:["compliant","noncompliant","unknown","all"],description:"Filter by compliance state. Default: all"},limit:{type:"number",description:"Max results (default 25, max 100)"}}}},
  {name:"get_intune_device",description:"Get full details for a specific Intune-managed device by device name, serial number, or device ID.",inputSchema:{type:"object",properties:{device:{type:"string",description:"Device name, serial number, or Intune device ID"}},required:["device"]}},
  {name:"get_noncompliant_devices",description:"List all non-compliant devices in Intune with the reason they are out of compliance. Use to identify devices that need attention.",inputSchema:{type:"object",properties:{platform:{type:"string",description:"Filter by OS: windows, ios, macos, android. Leave blank for all."}}}},
  {name:"get_device_compliance",description:"Get the compliance status and policy details for a specific user or device.",inputSchema:{type:"object",properties:{user:{type:"string",description:"User email or UPN to check all their devices"},device:{type:"string",description:"Device name or ID to check a specific device"}}}},
  {name:"sync_intune_device",description:"Trigger an immediate Intune sync on a device to push latest policies and check compliance.",inputSchema:{type:"object",properties:{device_id:{type:"string",description:"Intune device ID (get from get_intune_device)"}},required:["device_id"]}},
  {name:"get_intune_apps",description:"List apps deployed through Intune and their installation status across devices.",inputSchema:{type:"object",properties:{app_name:{type:"string",description:"Filter by app name (partial match)"},limit:{type:"number",description:"Max results (default 20)"}}}}
];

// â”€â”€ Tool handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handleTool(name, args) {
  // KB tools
  if(name==="search_kb"){return (function(q){return new Promise(function(done){var ht=require("https"),b=JSON.stringify({query:q});var req=ht.request({hostname:"hook.us2.make.com",path:"/ei14bxc9xiqr6ib1ls45313jji44v32b",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)}},function(r){var d="";r.on("data",function(c){d+=c;});r.on("end",function(){try{var j=JSON.parse(d),hits=[];if(j["results"]&&j["results"][0]&&j["results"][0]["hitsContainers"])j["results"][0]["hitsContainers"].forEach(function(hc){(hc["hits"]||[]).forEach(function(it){if(it["resource"])hits.push({name:(it["resource"]["name"]||""),library:((it["resource"]["webUrl"]||"").split("/").slice(-2,-1)[0]||"KB"),webUrl:(it["resource"]["webUrl"]||")")});});});done({content:[{type:"text",text:hits.length?JSON.stringify(hits,null,2):"No results found."}]});;}catch(e){done({content:[{type:"text",text:"No results found."}]});}});});req.on("error",function(){done({content:[{type:"text",text:"No results found."}]});});req.write(b);req.end();})})(args.query||"");}
if(name==="sync_learn_to_kb"){return syncLearnTopicToKB(args.topic,args.library,args.max_articles||3).then(function(r){var msg=r.uploaded>0?"Synced "+r.uploaded+" article(s) to "+r.library+":\n"+r.articles.map(function(a){return"â€¢ "+a.title+" ("+a.file+")";}).join("\n"):"Nothing uploaded. Skipped: "+r.skipped+" (no content or upload error).";return{content:[{type:"text",text:msg}]};}).catch(function(e){return{content:[{type:"text",text:"sync_learn_to_kb error: "+e.message}]};});}
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
      if(!devices.length)return{content:[{type:"text",text:"âœ“ No non-compliant devices found"+(args.platform?" for "+args.platform:"")+"!"}]};
      var list=devices.map(function(dev){return{name:dev.deviceName,user:dev.userDisplayName,os:dev.operatingSystem+" "+dev.osVersion,serial:dev.serialNumber,lastSync:dev.lastSyncDateTime};});
      return{content:[{type:"text",text:"âš  "+devices.length+" non-compliant device(s):\n\n"+JSON.stringify(list,null,2)}]};
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
      return getGraphToken().then(function(t){return new Promise(function(resolve,reject){var data=Buffer.from(b,"utf8");var r=https.request({hostname:"graph.microsoft.com",path:"/v1.0/deviceManagement/managedDevices/"+args.device_id+"/syncDevice",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":data.length}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){resolve({status:re.statusCode,body:d});});});r.on("error",reject);r.write(data);r.end();});}).then(function(r){if(r.status===204||r.status===200)return{content:[{type:"text",text:"âœ“ Sync triggered for device: "+(dev.deviceName||args.device_id)+". Device will check in shortly."}]};return{content:[{type:"text",text:"Sync request returned HTTP "+r.status+": "+r.body}]};});
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
  if(name==="sync_vendor_docs"){var validVendors=["cisco","dell","hp","hpe","fujitsu","apple"];if(!validVendors.includes((args.vendor||"").toLowerCase()))return Promise.resolve({content:[{type:"text",text:"Invalid vendor. Use: cisco, dell, hp, hpe, or fujitsu"}]});return syncVendorDocsToKB(args.vendor,args.topic,args.library||"troubleshooting",args.max_articles||3).then(function(r){var msg=r.uploaded>0?"Synced "+r.uploaded+" "+r.vendor.toUpperCase()+" article(s) to "+r.library+":\n"+r.articles.map(function(a){return"â€¢ "+a.title+" ("+a.file+")";}).join("\n"):"No "+r.vendor.toUpperCase()+" articles found or uploaded for: "+args.topic+". Skipped: "+r.skipped;return{content:[{type:"text",text:msg}]};}).catch(function(e){return{content:[{type:"text",text:"sync_vendor_docs error: "+e.message}]};});}
  if(name==="list_library"){return getDrives().then(function(drives){var drive=drives.find(function(d){return d.name.toLowerCase()===args.library.toLowerCase();});if(!drive)return{content:[{type:"text",text:"Available: "+drives.map(function(d){return d.name;}).join(", ")}]};return graph("/drives/"+drive.id+"/root/children").then(function(d){return{content:[{type:"text",text:JSON.stringify((d.value||[]).map(function(f){return{name:f.name,id:f.id,driveId:drive.id};}),null,2)}]};})});}
  if(name==="read_file"){return graph("/drives/"+args.drive_id+"/items/"+args.item_id).then(function(meta){var url=meta["@microsoft.graph.downloadUrl"];if(!url)return{content:[{type:"text",text:"Cannot download."}]};var u=new URL(url);return new Promise(function(resolve,reject){https.get({hostname:u.hostname,path:u.pathname+u.search},function(res){var d="";res.on("data",function(c){d+=c;});res.on("end",function(){resolve({content:[{type:"text",text:d.substring(0,8000)}]});});}).on("error",reject);});});}
  if(name==="ms_service_health"){var p=args&&args.service?"/admin/serviceAnnouncement/issues?$filter=status%20ne%20%27resolved%27%20and%20contains(service,%27"+encodeURIComponent(args.service)+"%27)":"/admin/serviceAnnouncement/issues?$filter=status%20ne%20%27resolved%27&$top=10";return graph(p).then(function(d){var issues=(d.value||[]).map(function(i){return{title:i.title,service:i.service,status:i.status,severity:i.classification};});return{content:[{type:"text",text:issues.length?"Active issues:\n"+JSON.stringify(issues,null,2):"All Microsoft 365 services healthy!"}]};});}
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
  if(name==="get_sign_in_logs"){var lim=args.limit||25;var logPath="/auditLogs/signIns?$top="+lim+"&$orderby=createdDateTime%20desc&$select=createdDateTime,userDisplayName,userPrincipalName,appDisplayName,ipAddress,status,location";if(args.user_id)logPath+="&$filter=userPrincipalName%20eq%20%27"+args.user_id+"%27";return graphGet(logPath).then(function(d){return{content:[{type:"text",text:(d.value||[]).length?JSON.stringify(d.value,null,2):"No sign-in logs found."}]};}).catch(function(e){return{content:[{type:"text",text:"get_sign_in_logs error: "+e.message}]};});}

  // Teams tools
  if(name==="list_teams"){return graphGet("/groups?$filter=resourceProvisioningOptions/Any(x:x%20eq%20%27Team%27)&$select=id,displayName,description").then(function(d){return{content:[{type:"text",text:JSON.stringify((d.value||[]).map(function(t){return{id:t.id,name:t.displayName};}),null,2)}]};}).catch(function(e){return{content:[{type:"text",text:"list_teams error: "+e.message}]};});}
  if(name==="list_channels"){return graphGet("/teams/"+args.team_id+"/channels?$select=id,displayName,membershipType").then(function(d){return{content:[{type:"text",text:JSON.stringify((d.value||[]).map(function(c){return{id:c.id,name:c.displayName};}),null,2)}]};}).catch(function(e){return{content:[{type:"text",text:"list_channels error: "+e.message}]};});}
  if(name==="get_channel_messages"){return graphGet("/teams/"+args.team_id+"/channels/"+args.channel_id+"/messages?$top="+(args.limit||10)).then(function(d){var msgs=(d.value||[]).map(function(m){return{from:(m.from&&m.from.user&&m.from.user.displayName)||"unknown",time:m.createdDateTime,message:(m.body&&m.body.content||"").replace(/<[^>]+>/g," ").trim().substring(0,300)};});return{content:[{type:"text",text:msgs.length?JSON.stringify(msgs,null,2):"No messages found."}]};}).catch(function(e){return{content:[{type:"text",text:"get_channel_messages error: "+e.message}]};});}
  if(name==="send_channel_message"){var wUrl=new URL(TEAMS_WEBHOOK_URL);var wBody=JSON.stringify({"@type":"MessageCard","@context":"http://schema.org/extensions","summary":args.message,"themeColor":"0076D7","text":args.html?args.message:"<pre>"+args.message+"</pre>"});return new Promise(function(resolve){var d=Buffer.from(wBody,"utf8");var r=https.request({hostname:wUrl.hostname,path:wUrl.pathname+wUrl.search,method:"POST",headers:{"Content-Type":"application/json","Content-Length":d.length}},function(re){var rb="";re.on("data",function(c){rb+=c;});re.on("end",function(){resolve({content:[{type:"text",text:re.statusCode===200?"Message posted to Teams â€” General channel":"Teams error (HTTP "+re.statusCode+"): "+rb}]});});});r.on("error",function(e){resolve({content:[{type:"text",text:"send_channel_message error: "+e.message}]});});r.write(d);r.end();});}

  if(name==="build_scenario"){return handleTool("search_kb",{query:args.problem}).then(function(kb){return Promise.all([Promise.resolve(kb),handleTool("ms_service_health",{}),handleTool("search_microsoft_learn",{query:args.problem})]);}).then(function(results){var now=new Date().toISOString().split("T")[0];var md="# Field Scenario: "+args.problem+"\n\n_Generated: "+now+"_\n\n";md+="## KB Results\n\n"+results[0].content[0].text+"\n\n";md+="## M365 Health\n\n"+results[1].content[0].text+"\n\n";md+="## Microsoft Learn\n\n"+results[2].content[0].text;return{content:[{type:"text",text:md}]};});}

  return Promise.resolve({content:[{type:"text",text:"Unknown tool: "+name}]});
}

// â”€â”€ Auth check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function checkAuth(reqHttp) {
  var auth = reqHttp.headers["authorization"] || "";
  return auth === "Bearer " + API_KEY;
}

// â”€â”€ MCP SSE transport â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handleSSE(reqHttp, res) {
  if (!checkAuth(reqHttp)) {
    res.writeHead(401, {"Content-Type": "application/json"});
    res.end(JSON.stringify({error: "Unauthorized â€” provide Authorization: Bearer <api-key>"}));
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
  // Send endpoint event â€” tells Claude where to POST messages
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

// â”€â”€ Chat intent router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // Try to parse JSON for richer formatting
  try {
    var data=JSON.parse(rawText);
    if(Array.isArray(data)&&data.length===0) return "No results found.";
    if(Array.isArray(data)) {
      if(toolName==="get_intune_devices"||toolName==="get_noncompliant_devices") {
        return (toolName==="get_noncompliant_devices"?"âš ï¸ ":"ðŸ“± ")+(data.length)+" device(s) found:\n\n"+data.map(function(d){return "ðŸ“± "+d.name+"\n   ðŸ‘¤ "+(d.user||d.email||"Unknown")+"\n   ðŸ’» "+(d.os||"")+"\n   "+(d.compliance==="compliant"?"âœ…":"âš ï¸")+" "+d.compliance+"\n   ðŸ• Last sync: "+(d.lastSync?new Date(d.lastSync).toLocaleString():"Unknown");}).join("\n\n");
      }
      if(toolName==="search_users") return "ðŸ‘¥ "+data.length+" user(s) found:\n\n"+data.map(function(u){return "ðŸ‘¤ "+u.name+"\n   "+u.upn+"\n   "+(u.dept||"No department")+" | "+(u.enabled?"âœ… Active":"ðŸ”´ Disabled");}).join("\n\n");
      if(toolName==="get_channel_messages") return "ðŸ’¬ Recent Teams messages:\n\n"+data.map(function(msg){return "â€¢ "+msg.from+" ("+new Date(msg.time).toLocaleString()+"):\n  "+msg.message;}).join("\n\n");
      if(toolName==="search_kb") return "ðŸ“š "+data.length+" KB article(s) found:\n\n"+data.map(function(f,i){return (i+1)+". ðŸ“„ "+f.name.replace(".md","").replace(/-/g," ")+"\n   Library: "+(f.library||"KB");}).join("\n\n")+"\n\nAsk me to read any of these articles for details.";
      if(toolName==="get_device_compliance") return "ðŸ” Compliance status:\n\n"+data.map(function(d){return "ðŸ“± "+d.device+"\n   "+(d.compliance==="compliant"?"âœ… Compliant":"âš ï¸ "+d.compliance)+"\n   ðŸ’» "+d.os+"\n   ðŸ” Encrypted: "+(d.encrypted?"Yes":"No")+"\n   ðŸ• "+new Date(d.lastSync).toLocaleString();}).join("\n\n");
      if(toolName==="get_user_groups") return "ðŸ·ï¸ Group memberships:\n\n"+data.map(function(g){return "â€¢ "+g.name+(g.description?"\n  "+g.description:"");}).join("\n\n");
      if(toolName==="get_sign_in_logs") return "ðŸ” Recent sign-ins:\n\n"+data.slice(0,8).map(function(s){return "â€¢ "+(s.userDisplayName||s.userPrincipalName||"Unknown")+"\n  App: "+(s.appDisplayName||"Unknown")+"\n  IP: "+(s.ipAddress||"Unknown")+"\n  "+(s.status&&s.status.errorCode===0?"âœ… Success":"âŒ Failed")+"\n  ðŸ• "+new Date(s.createdDateTime).toLocaleString();}).join("\n\n");
      if(toolName==="get_intune_apps") return "ðŸ“¦ "+data.length+" app(s) deployed:\n\n"+data.map(function(a){return "â€¢ "+a.name+(a.publisher?"\n  Publisher: "+a.publisher:"")+(a.state?"\n  State: "+a.state:"");}).join("\n\n");
      return rawText;
    }
    // Single object
    if(toolName==="get_user") return "ðŸ‘¤ "+data.displayName+"\nðŸ“§ "+data.upn+"\nðŸ¢ "+(data.department||"No department")+"\nðŸ’¼ "+(data.jobTitle||"No title")+"\n"+(data.accountEnabled?"âœ… Account active":"ðŸ”´ Account disabled")+"\nðŸ”‘ Password last changed: "+(data.lastPasswordChange?new Date(data.lastPasswordChange).toLocaleDateString():"Unknown");
    if(toolName==="get_intune_device") return "ðŸ“± "+data.name+"\nðŸ‘¤ "+(data.user||data.email||"Unknown")+"\nðŸ’» "+(data.os||"")+"\nðŸ”§ "+(data.model||"")+"\nðŸ”¢ Serial: "+(data.serial||"Unknown")+"\n"+(data.compliance==="compliant"?"âœ… Compliant":"âš ï¸ "+data.compliance)+"\nðŸ” Encrypted: "+(data.encrypted?"Yes":"No")+"\nðŸ’¾ Storage: "+(data.storage?data.storage.freeGB+" GB free of "+data.storage.totalGB+" GB":"Unknown")+"\nðŸ• Last sync: "+(data.lastSync?new Date(data.lastSync).toLocaleString():"Unknown");
    return rawText;
  } catch(e) { return rawText; }
}

// â”€â”€ Chat HTML UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function callClaude(msg){return new Promise(function(resolve){var https=require('https');var body=JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1024,system:'You are an expert IT support technician. Answer IT questions concisely and practically.',messages:[{role:'user',content:msg}]});var req=https.request({hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY||'','anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body)}},function(res){var d='';res.on('data',function(c){d+=c});res.on('end',function(){try{var p=JSON.parse(d);resolve(p.content&&p.content[0]?p.content[0].text:'No response.');}catch(e){resolve('AI error.');}});});req.on('error',function(e){resolve('Error: '+e.message);});req.write(body);req.end();});}

function callClaude(msg){return new Promise(function(resolve){var https=require('https');var body=JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1024,system:'You are an expert IT support technician for an organization using Microsoft 365, Windows 11, Cisco, and enterprise hardware. Answer helpfully and concisely.',messages:[{role:'user',content:msg}]});var req=https.request({hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY||'','anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body)}},function(res){var d='';res.on('data',function(chunk){d+=chunk});res.on('end',function(){try{var p=JSON.parse(d);resolve(p.content&&p.content[0]?p.content[0].text:'No response.');}catch(e){resolve('AI parse error.');}});});req.on('error',function(e){resolve('AI error: '+e.message);});req.write(body);req.end();});}
var CHAT_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
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
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.chip{padding:6px 13px;background:#0078d415;border:1px solid #0078d460;border-radius:20px;font-size:12px;cursor:pointer;color:#60a5fa;transition:background .2s}
.chip:hover{background:#0078d430}
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
</style>
</head>
<body>
<header>
  <div class="dot"></div>
  <h1>ðŸ”§ IT Agent</h1>
  <span>Field Support</span>
</header>
<div id="msgs">
  <div class="bubble agent">Hi! I'm your IT Knowledge Agent. Ask me anything â€” devices, users, KB articles, service health, or vendor troubleshooting.
<div class="chips">
  <span class="chip" onclick="ask(this.textContent)">Non-compliant devices</span>
  <span class="chip" onclick="ask(this.textContent)">M365 service health</span>
  <span class="chip" onclick="ask(this.textContent)">Step-by-step: reset Windows 11 network</span>
  <span class="chip" onclick="ask(this.textContent)">Script: flush DNS on Windows 11</span>
  <span class="chip" onclick="ask(this.textContent)">Cisco switch port not working steps</span>
  <span class="chip" onclick="ask(this.textContent)">Fujitsu ScanSnap Windows 11 driver setup</span>
</div>
  </div>
</div>
<footer>
  <input id="inp" placeholder="Ask anything..." autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send()}">
  <button onclick="send()">Send</button>
</footer>
<script>
var API_KEY='claudeITAgent2026';
function ask(t){document.getElementById('inp').value=t;send()}
function send(){
  var inp=document.getElementById('inp');
  var msg=inp.value.trim();
  if(!msg)return;
  inp.value='';
  addBubble(msg,'user');
  var loader=addBubble('Thinking...','agent loading');
  fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY},body:JSON.stringify({message:msg})})
    .then(function(r){return r.json()})
    .then(function(d){loader.remove();addBubble(d.response||'No response','agent')})
    .catch(function(e){loader.remove();addBubble('Error: '+e.message,'agent')});
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

// â”€â”€ HTTP server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const server = http.createServer(function(reqHttp, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (reqHttp.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  var path = (new URL(reqHttp.url, "http://localhost")).pathname;

  if (path === "/sse" && reqHttp.method === "GET") { handleSSE(reqHttp, res); return; }
  if (path === "/message" && reqHttp.method === "POST") { handleMessage(reqHttp, res); return; }

  // â”€â”€ Web Chat UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (path === "/chat" && reqHttp.method === "GET") {
    res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
    res.end(CHAT_HTML);
    return;
  }
  if (path === "/chat" && reqHttp.method === "POST") {
    if (!checkAuth(reqHttp)) {
      // For browser clients, check a session cookie or embedded key
      var authHeader = reqHttp.headers["authorization"] || "";
      if (authHeader !== "Bearer " + API_KEY) {
        res.writeHead(401, {"Content-Type":"application/json"});
        res.end(JSON.stringify({error:"Unauthorized"}));
        return;
      }
    }
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
        var route = routeChat(message);
        // Detect vendor from message for dual-source lookup
        var msgLower = message.toLowerCase();
        var detectedVendor = msgLower.includes("fujitsu")||msgLower.includes("scansnap")||msgLower.includes("fi-")?"fujitsu":
          msgLower.includes("cisco")||msgLower.includes("catalyst")||msgLower.includes("anyconnect")?"cisco":
          msgLower.includes("dell")||msgLower.includes("optiplex")||msgLower.includes("latitude")||msgLower.includes("idrac")?"dell":
          msgLower.includes("hp ")||msgLower.includes("laserjet")||msgLower.includes("elitebook")||msgLower.includes("hewlett")?"hp":
          msgLower.includes("apple")||msgLower.includes("macbook")||msgLower.includes("iphone")||msgLower.includes("ipad")||msgLower.includes("macos")?"apple":null;

        // â”€â”€ Smart article processor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

          // Script mode â€” lead with code
          if (wantsScript && codeBlocks.length > 0) {
            response += "ðŸ’» Script / Command Line:\n\n";
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
            if (s.title) response += "\nðŸ“Œ "+s.title+"\n";
            response += content.substring(0,900)+"\n";
            added++;
          });

          // If GUI mode and no script shown yet, append a script option at end
          if (!wantsScript && codeBlocks.length > 0) {
            response += "\n\nðŸ’» Script alternative:\n"+codeBlocks[0].substring(0,600);
          }

          return response.trim().substring(0,3500) + (response.length>3500 ? "\n\n[Reply 'continue' for more details]" : "");
        }

        function readAndRespond(files, prefix) {
          // Read top 2 articles and combine
          var topFiles = files.slice(0,2).filter(function(f){return f.driveId&&f.id;});
          if (!topFiles.length) return null;
          return Promise.all(topFiles.map(function(f){
            return handleTool("read_file",{drive_id:f.driveId,item_id:f.id}).then(function(r){
              return {name:f.name, text:r.content&&r.content[0]&&r.content[0].text||""};
            });
          })).then(function(articles) {
            var combined = articles.map(function(a){return a.text;}).join("\n\n---\n\n");
            var processed = processArticle(combined, message);
            var sources = articles.map(function(a){return "â€¢ "+a.name.replace(".md","").replace(/-/g," ");}).join("\n");
            var response = (prefix||"")+"ðŸ“š Sources:\n"+sources+"\n\n"+processed;
            res.writeHead(200,{"Content-Type":"application/json"});
            res.end(JSON.stringify({response:response}));
          });
        }

        handleTool(route.tool, route.args).then(function(result) {
          var rawText = result.content && result.content[0] && result.content[0].text || ""; if(!rawText||rawText===""||rawText==="[]"||rawText==="null"){return callClaude(message).then(function(ai){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({response:ai}));return;});}

          // KB returned file list â€” read top article immediately
          if (route.tool === "search_kb" && rawText.startsWith("[")) {
            try {
              var files = JSON.parse(rawText);
              if (files.length > 0) return readAndRespond(files, "");
            } catch(e) {}
          }

          // KB auto-synced from Learn â€” search again immediately and read result
          if (route.tool === "search_kb" && rawText.includes("Auto-synced")) {
            // Also trigger vendor sync in parallel if vendor detected
            var vendorSync = detectedVendor
              ? handleTool("sync_vendor_docs", {vendor: detectedVendor, topic: message, library: "Troubleshooting", max_articles: 2})
              : Promise.resolve(null);
            return vendorSync.then(function() {
              return handleTool("search_kb", {query: message});
            }).then(function(r2) {
              var t2 = r2.content && r2.content[0] && r2.content[0].text || "";
              if (t2.startsWith("[")) {
                try {
                  var files2 = JSON.parse(t2);
                  if (files2.length > 0) return readAndRespond(files2, detectedVendor ? "ðŸ“š Sources: Microsoft Learn + " + detectedVendor.toUpperCase() + " Support\n\n" : "ðŸ“š Source: Microsoft Learn\n\n");
                } catch(e) {}
              }
              res.writeHead(200, {"Content-Type":"application/json"});
              res.end(JSON.stringify({response: rawText}));
            });
          }

          // For vendor queries â€” also search KB for vendor articles
          if (detectedVendor && route.tool === "search_kb" && rawText.includes("No results")) {
            return handleTool("sync_vendor_docs", {vendor: detectedVendor, topic: message, library: "Troubleshooting", max_articles: 3}).then(function() {
              return handleTool("search_kb", {query: message});
            }).then(function(r2) {
              var t2 = r2.content && r2.content[0] && r2.content[0].text || "";
              if (t2.startsWith("[")) {
                try {
                  var files2 = JSON.parse(t2);
                  if (files2.length > 0) return readAndRespond(files2, "ðŸ“š Source: " + detectedVendor.toUpperCase() + " Support\n\n");
                } catch(e) {}
              }
              res.writeHead(200, {"Content-Type":"application/json"});
              res.end(JSON.stringify({response: "I searched Microsoft Learn and " + detectedVendor.toUpperCase() + " support but couldn't find specific content for: " + message}));
            });
          }

          var response = formatChatResponse(route.tool, rawText);
          if(!response||response==='No response received.'||response==='No results found.'){
            return callClaude(message).then(function(ai){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({response:ai}));});
          }
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
  res.writeHead(200, {"Content-Type":"application/json"});
  res.end(JSON.stringify({name:"IT Knowledge Agent",version:"8.0.0",status:"running",endpoints:["/sse","/message","/health","/query","/sync"]}));
});

server.listen(PORT, function() {
  console.log("IT Knowledge Agent v10.0 running on port " + PORT);
console.log("Web chat UI: /chat");
  console.log("MCP SSE endpoint: /sse");
});

