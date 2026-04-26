const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── Load .env (no external dependency; safe if .env missing) ─────────────────
try {
  var __envPath = path.join(__dirname, ".env");
  if (fs.existsSync(__envPath)) {
    fs.readFileSync(__envPath, "utf8").split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1");
      }
    });
  }
} catch (_) { /* fail open — fall back to pre-set env */ }

// ── Secrets and IDs now sourced from env (populated from .env or PM2) ────────
// NOTE: legacy SP app reg 50d28fcf was retired (task #28); SP and Graph token
// calls are both consolidated onto app reg 9c823e8e (GRAPH_CLIENT_ID).
const TENANT_ID           = process.env.AZURE_TENANT_ID || "e876d5db-a9f8-4e71-abc1-dcee4d8b0578";
const CLIENT_ID           = process.env.GRAPH_CLIENT_ID || process.env.AZURE_CLIENT_ID    || "";
const CLIENT_SECRET       = process.env.GRAPH_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || "";
const GRAPH_CLIENT_ID     = CLIENT_ID;
const GRAPH_CLIENT_SECRET = CLIENT_SECRET;
const TEAMS_WEBHOOK_URL   = process.env.TEAMS_WEBHOOK_URL || process.env.TEAMS_ALERTS_WEBHOOK || "";
const TEAMS_TEAM_ID       = process.env.TEAMS_IT_TEAM_ID || "1dede829-35a4-4d2b-96d4-ab4687aa13a5";
const TEAMS_CHANNEL_ID    = process.env.TEAMS_GENERAL_CHANNEL_ID || "19:h3O1iQ3KfOuqLoQKUtbWEa2lLMqHBwjX1qTlTK0lrqw1@thread.tacv2";
const TENANT_NAME         = "ClaudeITAgent";
const SITE_NAME           = "ITKnowledgeBase";
const SENDER_EMAIL        = process.env.SENDER_EMAIL || "manueltucker@claudeitagent.onmicrosoft.com";
const CISCO_KEY           = process.env.CISCO_KEY    || "";
const CISCO_SECRET        = process.env.CISCO_SECRET || "";

// Fail fast with a clear message if the critical secret is missing at startup.
if (!GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
  process.stderr.write("[server.js] WARN: GRAPH_CLIENT_ID/SECRET missing — Graph calls will 401 until .env is populated.\n");
}

let spToken=null,spExpiry=0,graphToken=null,graphExpiry=0,ciscoToken=null,ciscoExpiry=0,siteId=null,cachedDrives=[];

function req(o,b){return new Promise(function(res,rej){var r=https.request(o,function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{res({status:re.statusCode,body:JSON.parse(d)});}catch(e){res({status:re.statusCode,body:d});}});});r.on("error",rej);if(b)r.write(b);r.end();});}

function getGraphToken(){if(graphToken&&Date.now()<graphExpiry)return Promise.resolve(graphToken);var b="grant_type=client_credentials&client_id="+encodeURIComponent(GRAPH_CLIENT_ID)+"&client_secret="+encodeURIComponent(GRAPH_CLIENT_SECRET)+"&scope="+encodeURIComponent("https://graph.microsoft.com/.default");return req({hostname:"login.microsoftonline.com",path:"/"+TENANT_ID+"/oauth2/v2.0/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(b)}},b).then(function(r){graphToken=r.body.access_token;graphExpiry=Date.now()+(r.body.expires_in-60)*1000;return graphToken;});}

function getSPToken(){if(spToken&&Date.now()<spExpiry)return Promise.resolve(spToken);var b="grant_type=client_credentials&client_id="+encodeURIComponent(CLIENT_ID)+"&client_secret="+encodeURIComponent(CLIENT_SECRET)+"&scope="+encodeURIComponent("https://graph.microsoft.com/.default");return req({hostname:"login.microsoftonline.com",path:"/"+TENANT_ID+"/oauth2/v2.0/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(b)}},b).then(function(r){spToken=r.body.access_token;spExpiry=Date.now()+(r.body.expires_in-60)*1000;return spToken;});}

function getCiscoToken(){if(ciscoToken&&Date.now()<ciscoExpiry)return Promise.resolve(ciscoToken);var b="grant_type=client_credentials&client_id="+encodeURIComponent(CISCO_KEY)+"&client_secret="+encodeURIComponent(CISCO_SECRET);return req({hostname:"id.cisco.com",path:"/oauth2/default/v1/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(b)}},b).then(function(r){ciscoToken=r.body.access_token;ciscoExpiry=Date.now()+3500000;return ciscoToken;});}

// ── Fetch plain text from a manufacturer URL ─────────────────
function fetchPageText(urlString, maxLen) {
  maxLen = maxLen || 2500;
  return new Promise(function(resolve) {
    try {
      var u = new URL(urlString);
      if (u.protocol !== "https:") { resolve(""); return; }
      var r = https.get({
        hostname: u.hostname, path: u.pathname + u.search,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html,application/xhtml+xml" }
      }, function(res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(fetchPageText(res.headers.location, maxLen)); return;
        }
        var data = "";
        res.on("data", function(c) { data += c; if (data.length > 150000) res.destroy(); });
        res.on("end", function() {
          var text = data
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[\s\S]*?<\/nav>/gi, "")
            .replace(/<header[\s\S]*?<\/header>/gi, "")
            .replace(/<footer[\s\S]*?<\/footer>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/\s{2,}/g, " ").trim();
          resolve(text.substring(0, maxLen));
        });
      });
      r.on("error", function() { resolve(""); });
      r.setTimeout(12000, function() { r.destroy(); resolve(""); });
    } catch(e) { resolve(""); }
  });
}

function graph(path){return getSPToken().then(function(t){return req({hostname:"graph.microsoft.com",path:"/v1.0"+path,method:"GET",headers:{Authorization:"Bearer "+t}});}).then(function(r){return r.body;});}

function graphPost(path,body){var b=JSON.stringify(body);return getGraphToken().then(function(t){return req({hostname:"graph.microsoft.com",path:"/v1.0"+path,method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)}},b);}).then(function(r){return r.body;});}

function graphSearch(path,params){return getGraphToken().then(function(t){var qs=Object.entries(params||{}).map(function(e){return encodeURIComponent(e[0])+"="+encodeURIComponent(e[1]);}).join("&");return req({hostname:"graph.microsoft.com",path:"/v1.0"+path+(qs?"?"+qs:""),method:"GET",headers:{Authorization:"Bearer "+t,ConsistencyLevel:"eventual"}});}).then(function(r){return r.body;});}

function graphGet(path){return getGraphToken().then(function(t){return req({hostname:"graph.microsoft.com",path:"/v1.0"+path,method:"GET",headers:{Authorization:"Bearer "+t}});}).then(function(r){return r.body;});}

function getSiteId(){if(siteId)return Promise.resolve(siteId);return graph("/sites/"+TENANT_NAME+".sharepoint.com:/sites/"+SITE_NAME+":").then(function(d){siteId=d.id;return siteId;});}

function getDrives(){if(cachedDrives.length)return Promise.resolve(cachedDrives);return getSiteId().then(function(id){return graph("/sites/"+id+"/drives");}).then(function(d){cachedDrives=d.value||[];return cachedDrives;});}

var TOOLS=[
  {name:"search_kb",description:"Search IT Knowledge Base for scripts, runbooks, FAQs, assets, cabling, or troubleshooting guides",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}},
  {name:"list_library",description:"List files in a library: Scripts, Runbooks, FAQs, Assets, Cabling, or Troubleshooting",inputSchema:{type:"object",properties:{library:{type:"string"}},required:["library"]}},
  {name:"read_file",description:"Read contents of a file from the knowledge base",inputSchema:{type:"object",properties:{drive_id:{type:"string"},item_id:{type:"string"}},required:["drive_id","item_id"]}},
  {name:"ms_service_health",description:"Check live Microsoft 365 service health and active outages",inputSchema:{type:"object",properties:{service:{type:"string"}}}},
  {name:"ms_maintenance",description:"Get upcoming Microsoft 365 planned maintenance",inputSchema:{type:"object",properties:{}}},
  {name:"cisco_advisories",description:"Search Cisco PSIRT security advisories by product",inputSchema:{type:"object",properties:{product:{type:"string"}},required:["product"]}},
  {name:"cisco_cve",description:"Look up a specific CVE in Cisco advisories",inputSchema:{type:"object",properties:{cve:{type:"string"}},required:["cve"]}},
  {name:"search_microsoft_learn",description:"Search Microsoft Learn documentation",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}},
  {name:"web_search",description:"Search the web for IT information",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}},
  {name:"send_email",description:"Send an email from the IT agent. Use to deliver reference cards, runbooks, reports, or any content directly to a recipient. Supports plain text or HTML body.",inputSchema:{type:"object",properties:{to:{type:"string",description:"Recipient email address"},subject:{type:"string",description:"Email subject line"},body:{type:"string",description:"Email body — plain text or HTML"},is_html:{type:"boolean",description:"Set true if body is HTML (default: true)"}},required:["to","subject","body"]}},
  {name:"upload_to_kb",description:"Upload a markdown file to a SharePoint IT Knowledge Base library (FAQs, Runbooks, Troubleshooting, Assets, Scripts, or Cabling)",inputSchema:{type:"object",properties:{library:{type:"string",description:"Library name: FAQs, Runbooks, Troubleshooting, Assets, Scripts, or Cabling"},filename:{type:"string",description:"Filename including .md extension"},content:{type:"string",description:"Markdown content of the file"}},required:["library","filename","content"]}},
  {name:"build_scenario",description:"Build a structured field troubleshooting scenario from a problem description. Automatically searches the KB, checks live M365 service health, Cisco security advisories, and Microsoft Learn — then returns a step-by-step test plan based on manufacturer documentation.",inputSchema:{type:"object",properties:{problem:{type:"string",description:"Describe the field situation, e.g. 'Dell OptiPlex WiFi not connecting and Outlook wont open'"}},required:["problem"]}},

  // ── Phase 2: Azure AD ─────────────────────────────────────────
  {name:"get_user",description:"Get an Azure AD user profile by email or object ID — returns account status, department, job title, last password change",inputSchema:{type:"object",properties:{user_id:{type:"string",description:"User email (UPN) or Azure AD object ID"}},required:["user_id"]}},
  {name:"search_users",description:"Search Azure AD users by name or email",inputSchema:{type:"object",properties:{query:{type:"string",description:"Name or email fragment to search"},limit:{type:"number",description:"Max results (default 10)"}},required:["query"]}},
  {name:"get_user_groups",description:"Get all group memberships for an Azure AD user",inputSchema:{type:"object",properties:{user_id:{type:"string",description:"User email (UPN) or object ID"}},required:["user_id"]}},
  {name:"list_devices",description:"List Azure AD / Intune-registered devices, optionally filtered (e.g. by OS or device name)",inputSchema:{type:"object",properties:{filter:{type:"string",description:"OData filter e.g. \"operatingSystem eq 'Windows'\" or \"displayName eq 'DESKTOP-ABC'\""}}}},
  {name:"get_sign_in_logs",description:"Get recent Azure AD sign-in logs for a user — useful for troubleshooting auth failures or MFA issues",inputSchema:{type:"object",properties:{user_id:{type:"string",description:"User email (UPN) — omit for org-wide last 25 logins"},limit:{type:"number",description:"Number of records (default 25)"}}}},

  // ── Phase 1: Teams ────────────────────────────────────────────
  {name:"list_teams",description:"List all Microsoft Teams in the organisation",inputSchema:{type:"object",properties:{}}},
  {name:"list_channels",description:"List all channels in a Microsoft Team",inputSchema:{type:"object",properties:{team_id:{type:"string",description:"Team object ID (get from list_teams)"}},required:["team_id"]}},
  {name:"get_channel_messages",description:"Read recent messages from a Teams channel",inputSchema:{type:"object",properties:{team_id:{type:"string"},channel_id:{type:"string"},limit:{type:"number",description:"Number of messages (default 10)"}},required:["team_id","channel_id"]}},
  {name:"send_channel_message",description:"Post a message to a Microsoft Teams channel — supports plain text or HTML",inputSchema:{type:"object",properties:{team_id:{type:"string"},channel_id:{type:"string"},message:{type:"string",description:"Message content"},html:{type:"boolean",description:"Set true to send as HTML (default false)"}},required:["team_id","channel_id","message"]}},

  // ── OneNote Workflows ─────────────────────────────────────────
  {name:"create_workflow",description:"Create a step-by-step IT workflow page in OneNote with checkboxes for field techs. Use for tasks like Cisco phone install, Autopilot setup, network config, etc. Generates a checklist page in the IT Workflows notebook that techs can follow on mobile and tick off as they go.",inputSchema:{type:"object",properties:{title:{type:"string",description:"Workflow title, e.g. 'Cisco Phone Install — Site A'"},task_type:{type:"string",description:"Task category: 'cisco_phone', 'autopilot', 'network', 'printer', 'custom'"},steps:{type:"array",items:{type:"object",properties:{heading:{type:"string"},items:{type:"array",items:{type:"string"}}}},description:"Array of sections, each with a heading and checklist items. If omitted, uses the built-in template for the task_type."},tech_name:{type:"string",description:"Name of the field tech assigned to this job"},site:{type:"string",description:"Site or location name"},notes:{type:"string",description:"Any additional notes or special instructions for this job"}},required:["title","task_type"]}},
  {name:"list_workflows",description:"List all IT workflow pages in the OneNote IT Workflows notebook",inputSchema:{type:"object",properties:{task_type:{type:"string",description:"Filter by task type section (optional): cisco_phone, autopilot, network, printer, custom"}}}}
];

function handleTool(name,args){
  if(name==="search_kb"){var KB_PATH="https://"+TENANT_NAME.toLowerCase()+".sharepoint.com/sites/"+SITE_NAME;var sbody={requests:[{entityTypes:["driveItem"],query:{queryString:args.query+" path:\""+KB_PATH+"\""},from:0,size:25}]};return graphPost("/search/query",sbody).then(function(d){var hits=((((d.value||[])[0]||{}).hitsContainers||[])[0]||{}).hits||[];var r=hits.slice(0,8).map(function(h){var res=h.resource||{};var pr=res.parentReference||{};return{name:res.name,id:res.id,driveId:pr.driveId,library:pr.name,webUrl:res.webUrl};});return{content:[{type:"text",text:r.length?JSON.stringify(r,null,2):"No results for: "+args.query}]};}).catch(function(e){return{content:[{type:"text",text:"search_kb error: "+e.message}]};});}
  if(name==="list_library"){return getDrives().then(function(drives){var drive=drives.find(function(d){return d.name.toLowerCase()===args.library.toLowerCase();});if(!drive)return{content:[{type:"text",text:"Available: "+drives.map(function(d){return d.name;}).join(", ")}]};return graph("/drives/"+drive.id+"/root/children").then(function(d){return{content:[{type:"text",text:JSON.stringify((d.value||[]).map(function(f){return{name:f.name,id:f.id,driveId:drive.id};}),null,2)}]};})});}
  if(name==="read_file"){return graph("/drives/"+args.drive_id+"/items/"+args.item_id).then(function(meta){var url=meta["@microsoft.graph.downloadUrl"];if(!url)return{content:[{type:"text",text:"Cannot download."}]};var u=new URL(url);return new Promise(function(resolve,reject){https.get({hostname:u.hostname,path:u.pathname+u.search},function(res){var d="";res.on("data",function(c){d+=c;});res.on("end",function(){resolve({content:[{type:"text",text:d.substring(0,8000)}]});});}).on("error",reject);});});}
  if(name==="ms_service_health"){var flt=args&&args.service?"status ne 'resolved' and contains(service,'"+String(args.service).replace(/'/g,"''")+"')":"status ne 'resolved'";var p="/admin/serviceAnnouncement/issues?$filter="+encodeURIComponent(flt);if(!args||!args.service)p+="&$top=10";return graphGet(p).then(function(d){var issues=(d.value||[]).map(function(i){return{title:i.title,service:i.service,status:i.status,severity:i.classification};});return{content:[{type:"text",text:issues.length?"Active issues:\n"+JSON.stringify(issues,null,2):"All Microsoft 365 services healthy!"}]};}).catch(function(e){return{content:[{type:"text",text:"ms_service_health error: "+e.message}]};});}
  if(name==="ms_maintenance"){return graph("/admin/serviceAnnouncement/messages?$filter=messageType%20eq%20%27planForChange%27&$top=5").then(function(d){var msgs=(d.value||[]).map(function(m){return{title:m.title,services:m.services,published:m.publishedDateTime};});return{content:[{type:"text",text:msgs.length?JSON.stringify(msgs,null,2):"No upcoming planned maintenance."}]};});}
  if(name==="cisco_advisories"){return getCiscoToken().then(function(t){return req({hostname:"apix.cisco.com",path:"/security/advisories/v2/product?product="+encodeURIComponent(args.product),method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}});}).then(function(r){var a=(r.body.advisories||[]).slice(0,5).map(function(a){return{title:a.advisoryTitle,severity:a.sir,cves:a.cves,published:a.publishedOn};});return{content:[{type:"text",text:a.length?JSON.stringify(a,null,2):"No advisories for: "+args.product}]};}).catch(function(e){return{content:[{type:"text",text:"Cisco error: "+e.message}]};});}
  if(name==="cisco_cve"){return getCiscoToken().then(function(t){return req({hostname:"apix.cisco.com",path:"/security/advisories/v2/cve/"+encodeURIComponent(args.cve),method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}});}).then(function(r){return{content:[{type:"text",text:JSON.stringify(r.body,null,2)}]};}).catch(function(e){return{content:[{type:"text",text:"CVE error: "+e.message}]};});}
  if(name==="search_microsoft_learn"){return req({hostname:"learn.microsoft.com",path:"/api/search?search="+encodeURIComponent(args.query)+"&locale=en-us&$top=5",method:"GET",headers:{Accept:"application/json"}}).then(function(r){var results=(r.body.results||[]).map(function(i){return{title:i.title,url:i.url,description:i.description};});return{content:[{type:"text",text:results.length?JSON.stringify(results,null,2):"No results for: "+args.query}]};}).catch(function(e){return{content:[{type:"text",text:"MS Learn error: "+e.message}]};});}
  if(name==="web_search"){return req({hostname:"html.duckduckgo.com",path:"/html/?q="+encodeURIComponent(args.query),method:"GET",headers:{"User-Agent":"Mozilla/5.0","Accept":"text/html"}}).then(function(r){var text=typeof r.body==="string"?r.body:JSON.stringify(r.body);var s=[];var rx=/class="result__snippet"[^>]*>([^<]{20,300})/g;var m;while((m=rx.exec(text))!==null&&s.length<5)s.push(m[1].trim());return{content:[{type:"text",text:s.length?s.join("\n\n---\n\n"):"Search done for: "+args.query}]};}).catch(function(e){return{content:[{type:"text",text:"Search error: "+e.message}]};});}
  if(name==="send_email"){
    var isHtml=(args.is_html!==false);
    var mailBody=JSON.stringify({message:{subject:args.subject,body:{contentType:isHtml?"HTML":"Text",content:args.body},toRecipients:[{emailAddress:{address:args.to}}]},saveToSentItems:true});
    return getSPToken().then(function(t){
      return new Promise(function(resolve,reject){
        var data=Buffer.from(mailBody,"utf8");
        var r=https.request({hostname:"graph.microsoft.com",path:"/v1.0/users/"+encodeURIComponent(SENDER_EMAIL)+"/sendMail",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":data.length}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){resolve({status:re.statusCode,body:d});});});
        r.on("error",reject);r.write(data);r.end();
      });
    }).then(function(r){
      if(r.status===202||r.status===200)return{content:[{type:"text",text:"Email sent to "+args.to+" — Subject: "+args.subject}]};
      return{content:[{type:"text",text:"Email send failed (HTTP "+r.status+"): "+r.body}]};
    }).catch(function(e){return{content:[{type:"text",text:"Email error: "+e.message}]};});
  }
  if(name==="upload_to_kb"){
    var LIBRARY_DRIVES={"faqs":"b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-0YkaK7sToQb9UfBCD0V8l","troubleshooting":"b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d-s9M-vo64gR6RqcavYF4co","runbooks":"b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d8ntgJz28NVQ5IBUqynE4Gk","assets":"b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9OV5yeNjEWSZzs4VJ2fbAB","cabling":"b!KAb296Hrk0ep9AvCIWq7npLU2tvhB3lCoKSMLhg07d9lg9HgzNLwT7cu7swCUvqF"};
    var driveId=LIBRARY_DRIVES[(args.library||"").toLowerCase()];
    if(!driveId)return Promise.resolve({content:[{type:"text",text:"Unknown library: "+args.library+". Use: FAQs, Runbooks, Troubleshooting, Assets, or Cabling"}]});
    var fileData=Buffer.from(args.content,"utf8");
    var uploadPath="/v1.0/drives/"+driveId+"/root:/"+encodeURIComponent(args.filename)+":/content";
    return getSPToken().then(function(t){
      return new Promise(function(resolve,reject){
        var r=https.request({hostname:"graph.microsoft.com",path:uploadPath,method:"PUT",headers:{Authorization:"Bearer "+t,"Content-Type":"text/plain; charset=utf-8","Content-Length":fileData.length}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{resolve({status:re.statusCode,body:JSON.parse(d)});}catch(e){resolve({status:re.statusCode,body:d});}});});
        r.on("error",reject);r.write(fileData);r.end();
      });
    }).then(function(r){
      if(r.status===200||r.status===201)return{content:[{type:"text",text:"Uploaded "+args.filename+" to "+args.library+" library. URL: "+(r.body.webUrl||"n/a")}]};
      return{content:[{type:"text",text:"Upload failed (HTTP "+r.status+"): "+JSON.stringify(r.body)}]};
    }).catch(function(e){return{content:[{type:"text",text:"Upload error: "+e.message}]};});
  }
  if(name==="build_scenario"){
    var problem=args.problem||"";
    var words=problem.toLowerCase();
    var isCisco=/cisco|switch|router|meraki|catalyst|asa|firepower|network|wifi|wireless|connectivity|vlan/i.test(words);
    var isDell=/dell|optiplex|latitude|inspiron|poweredge|xps|vostro|precision/i.test(words);
    var isHP=/\bhp\b|hewlett|packard|laserjet|officejet|deskjet|envy|pavilion|elitebook|probook|zbook|omen|scanjet|hp printer|hp scanner|hp computer/i.test(words);
    var isFujitsu=/fujitsu|scansnap|fi-[0-9]|scanfront|pfu|ix[0-9]|sp-[0-9]/i.test(words);
    var isM365=/outlook|teams|office|sharepoint|onedrive|microsoft|azure|365|email|calendar/i.test(words);
    var isNetwork=/wifi|wireless|connect|network|internet|ping|dns|ip /i.test(words);
    var ciscoProduct="Catalyst";
    if(/meraki/i.test(words))ciscoProduct="Meraki";
    else if(/asa/i.test(words))ciscoProduct="ASA";
    else if(/firepower/i.test(words))ciscoProduct="Firepower";
    var stopWords=/^(i|i'm|im|on|site|with|a|an|the|and|or|is|not|won't|wont|cant|can't|have|has|my|me|we|it|its|at|in|of|to|for|this|that|are|was|be|been|will|just|also|but|so|then|when|if)$/i;
    var keywords=problem.split(/\s+/).filter(function(w){return w.length>2&&!stopWords.test(w.replace(/[^a-zA-Z]/g,""));});
    var kbTerms=[];
    if(isDell)kbTerms.push("dell "+keywords.filter(function(w){return!/dell/i.test(w);}).slice(0,3).join(" "));
    if(isHP)kbTerms.push("hp "+keywords.filter(function(w){return!/\bhp\b/i.test(w);}).slice(0,3).join(" "));
    if(isFujitsu)kbTerms.push("fujitsu "+keywords.filter(function(w){return!/fujitsu|scansnap/i.test(w);}).slice(0,3).join(" "));
    if(isM365)kbTerms.push(keywords.filter(function(w){return/outlook|teams|office|sharepoint|onedrive|email/i.test(w);}).join(" ")||"microsoft 365 connectivity");
    if(isCisco||isNetwork)kbTerms.push("network "+keywords.filter(function(w){return/wifi|wireless|connect|network|internet/i.test(w);}).join(" ")||"network connectivity troubleshooting");
    if(!kbTerms.length)kbTerms.push(keywords.slice(0,5).join(" "));
    var learnQuery=isM365?"troubleshoot "+(words.includes("outlook")?"Outlook connectivity":words.includes("teams")?"Microsoft Teams":words.includes("sharepoint")?"SharePoint":"Microsoft 365"):isNetwork?"Windows network troubleshooting WiFi":"IT troubleshoot "+problem.split(" ").slice(0,3).join(" ");
    var searches=[];
    kbTerms.forEach(function(term){
      searches.push(handleTool("search_kb",{query:term}).then(function(r){return{source:"KB",query:term,result:r.content[0].text};}).catch(function(){return{source:"KB",query:term,result:"No results"};}));
    });
    searches.push(handleTool("ms_service_health",{}).then(function(r){return{source:"M365 Health",result:r.content[0].text};}).catch(function(){return{source:"M365 Health",result:"Unable to check"};}));
    if(isCisco)searches.push(handleTool("cisco_advisories",{product:ciscoProduct}).then(function(r){return{source:"Cisco PSIRT",product:ciscoProduct,result:r.content[0].text};}).catch(function(){return{source:"Cisco PSIRT",result:"Unable to check"};}));
    searches.push(handleTool("search_microsoft_learn",{query:learnQuery}).then(function(r){return{source:"Microsoft Learn",query:learnQuery,result:r.content[0].text};}).catch(function(){return{source:"Microsoft Learn",result:"No results"};}));
    return Promise.all(searches).then(function(results){
      // Fetch live content from MS Learn and Cisco URLs found in results
      var fetchJobs=[];
      results.forEach(function(r,idx){
        if(r.source==="Microsoft Learn"){
          try{
            var docs=JSON.parse(r.result);
            var urls=(docs||[]).slice(0,2).map(function(d){return d.url;}).filter(Boolean);
            urls.forEach(function(url){
              fetchJobs.push(fetchPageText(url,2500).then(function(text){
                r.liveContent=(r.liveContent||"")+(text?"\n\n---\n_Live content from: "+url+"_\n\n"+text:"");
              }));
            });
          }catch(e){}
        }
        if(r.source==="Cisco PSIRT"){
          try{
            var advisories=JSON.parse(r.result);
            var urls2=(advisories||[]).slice(0,2).map(function(a){return a.publicationUrl;}).filter(Boolean);
            urls2.forEach(function(url){
              fetchJobs.push(fetchPageText(url,2000).then(function(text){
                r.liveContent=(r.liveContent||"")+(text?"\n\n---\n_Live content from: "+url+"_\n\n"+text:"");
              }));
            });
          }catch(e){}
        }
      });
      return Promise.all(fetchJobs).then(function(){ return results; });
    }).then(function(results){
      var now=new Date().toISOString().split("T")[0];
      var md="# Field Scenario: "+problem+"\n\n";
      md+="_Generated: "+now+" | Sources: KB + Live Manufacturer Data_\n\n---\n\n";
      md+="## Situation\n\n"+problem+"\n\n";
      md+="## Quick Checks First (under 2 minutes)\n\n";
      md+="- **Reboot** — confirm whether a reboot was already attempted\n";
      if(isM365)md+="- **Check M365 service health** — rule out a Microsoft outage before touching the device\n";
      if(isDell)md+="- **Dell Service Tag** — run `wmic bios get serialnumber` in CMD for warranty/docs lookup\n";
      if(isHP)md+="- **HP Product Number** — found on the label (bottom/back of unit) — needed for support.hp.com driver lookup\n";
      if(isFujitsu)md+="- **Fujitsu Model Number** — label on bottom or back of scanner — needed for driver and firmware lookup\n";
      if(isNetwork||isCisco)md+="- **Ping test** — `ping 8.8.8.8` to confirm if internet is reachable at all\n";
      md+="\n## Manufacturer Source Findings\n\n";
      results.forEach(function(r){
        md+="### "+r.source+(r.query?" — \""+r.query+"\"":" ")+(r.product?" ("+r.product+")":"")+"\n\n";
        if(r.result==="No results"||r.result==="Unable to check"){md+="_No relevant findings at this time._\n\n";}
        else{
          md+=r.result.substring(0,600)+(r.result.length>600?"\n\n_(metadata summary)_":"")+"\n\n";
          if(r.liveContent){md+="**Live content fetched from manufacturer:**\n\n"+r.liveContent.substring(0,1800)+"\n\n";}
        }
      });
      md+="## Test Scenarios\n\n";
      var s=1;
      if(isM365){
        md+="**Scenario "+s+++": Confirm it is not a Microsoft outage**\n";
        md+="- Review M365 Health findings above\n";
        md+="- If active outage → log ticket, notify user, monitor https://aka.ms/m365status, wait\n";
        md+="- If no outage → proceed to device-level steps below\n\n";
      }
      if(isNetwork||isCisco){
        md+="**Scenario "+s+++": Isolate the network layer**\n";
        md+="- `ping 127.0.0.1` — fails = network stack broken → run `netsh winsock reset` then reboot\n";
        md+="- `ping 8.8.8.8` — fails = no internet → check WiFi/cable, try alternate network\n";
        md+="- `ping google.com` — fails but IP works = DNS issue → run `ipconfig /flushdns`\n";
        md+="- Check WiFi adapter in Device Manager for yellow warning icons or driver errors\n\n";
      }
      if(isDell){
        md+="**Scenario "+s+++": Dell hardware diagnostics**\n";
        md+="- Run Dell SupportAssist (pre-installed) or visit support.dell.com with Service Tag\n";
        md+="- Check LED diagnostic codes on device (see KB: dell-hardware-troubleshooting.md)\n";
        md+="- Confirm BIOS and drivers are current using Dell Update utility\n\n";
      }
      if(isHP){
        md+="**Scenario "+s+++": HP hardware diagnostics**\n";
        md+="- Visit [support.hp.com](https://support.hp.com) → enter Product Number for device-specific drivers and advisories\n";
        md+="- For printers: print a Configuration Page (hold Cancel button 3 sec) to confirm firmware version\n";
        md+="- For computers: run HP PC Hardware Diagnostics (F2 at boot or preinstalled app)\n";
        md+="- Check HP security advisories: support.hp.com/us-en/security-advisories (see KB: hp-support-updates.md)\n";
        md+="- Update firmware/drivers via HP Support Assistant (pre-installed) or manual download from support.hp.com\n\n";
      }
      if(isFujitsu){
        md+="**Scenario "+s+++": Fujitsu scanner diagnostics**\n";
        md+="- Confirm scanner model from label, then check [scansnap.fujitsu.com](https://scansnap.fujitsu.com/global/support/) or [pfu.fujitsu.com](https://www.pfu.fujitsu.com/en/scanners/support/)\n";
        md+="- Run ScanSnap Home or PaperStream IP diagnostics from the software menu\n";
        md+="- Check USB/network cable seating — Fujitsu scanners frequently drop connection on worn USB ports\n";
        md+="- Update scanner driver: download latest from Fujitsu site using model number (see KB: fujitsu-scanner-support.md)\n";
        md+="- For paper jam errors: clean rollers with IPA wipe, check for torn paper fragments in feed path\n\n";
      }
      if(isM365){
        md+="**Scenario "+s+++": Microsoft app-level fix**\n";
        md+="- Sign out and back in to the affected app\n";
        md+="- Test if issue affects one M365 app or all of them\n";
        md+="- Repair Office: Control Panel → Programs → Microsoft 365 → Change → Quick Repair\n";
        md+="- Clear saved credentials: Control Panel → Credential Manager → remove Office/Teams entries\n";
        md+="- Force update: `%ProgramFiles%\\Common Files\\Microsoft Shared\\ClickToRun\\OfficeC2RClient.exe /update user`\n\n";
      }
      md+="## Escalation Path\n\n";
      md+="| Condition | Action |\n|---|---|\n";
      if(isM365)md+="| Active M365 outage confirmed | Log ticket, notify user, monitor aka.ms/m365status |\n";
      if(isDell)md+="| Hardware fault confirmed by diagnostics | Open Dell support case with Service Tag |\n";
      if(isHP)md+="| HP hardware fault confirmed | Open HP support case at support.hp.com with Product Number |\n";
      if(isFujitsu)md+="| Fujitsu scanner hardware fault | Contact Fujitsu/PFU support at pfu.fujitsu.com with model/serial |\n";
      if(isCisco)md+="| Active Cisco advisory matches your equipment | Apply patch per advisory or escalate to network team |\n";
      md+="| All scenarios tried, issue persists | Escalate to Tier 2 with full documentation of steps taken |\n\n";
      md+="---\n_Sources: IT Knowledge Base · Cisco PSIRT API · Microsoft Graph Service Health · Microsoft Learn_\n";
      return{content:[{type:"text",text:md}]};
    });
  }
  // ── Phase 2: Azure AD ─────────────────────────────────────────
  if(name==="get_user"){
    var sel="id,displayName,userPrincipalName,mail,accountEnabled,department,jobTitle,officeLocation,mobilePhone,createdDateTime,lastPasswordChangeDateTime";
    return graphGet("/users/"+encodeURIComponent(args.user_id)+"?$select="+sel).then(function(u){
      return{content:[{type:"text",text:JSON.stringify({displayName:u.displayName,upn:u.userPrincipalName,accountEnabled:u.accountEnabled,department:u.department,jobTitle:u.jobTitle,officeLocation:u.officeLocation,mobilePhone:u.mobilePhone,lastPasswordChange:u.lastPasswordChangeDateTime,created:u.createdDateTime},null,2)}]};
    }).catch(function(e){return{content:[{type:"text",text:"get_user error: "+e.message}]};});
  }
  if(name==="search_users"){
    var lim=args.limit||10;
    return graphSearch("/users",{"$search":'"displayName:'+args.query+'" OR "mail:'+args.query+'"',"$top":lim,"$select":"id,displayName,userPrincipalName,accountEnabled,department,jobTitle","$orderby":"displayName"}).then(function(d){
      var users=(d.value||[]).map(function(u){return{name:u.displayName,upn:u.userPrincipalName,enabled:u.accountEnabled,dept:u.department,title:u.jobTitle};});
      return{content:[{type:"text",text:users.length?JSON.stringify(users,null,2):"No users found matching: "+args.query}]};
    }).catch(function(e){return{content:[{type:"text",text:"search_users error: "+e.message}]};});
  }
  if(name==="get_user_groups"){
    return graphGet("/users/"+encodeURIComponent(args.user_id)+"/memberOf?$select=id,displayName,description,groupTypes").then(function(d){
      var groups=(d.value||[]).map(function(g){return{name:g.displayName,description:g.description};});
      return{content:[{type:"text",text:groups.length?JSON.stringify(groups,null,2):"No group memberships found for: "+args.user_id}]};
    }).catch(function(e){return{content:[{type:"text",text:"get_user_groups error: "+e.message}]};});
  }
  if(name==="list_devices"){
    var dPath="/devices?$top=50&$select=id,displayName,operatingSystem,operatingSystemVersion,isCompliant,isManaged,registeredDateTime";
    if(args.filter)dPath+="&$filter="+encodeURIComponent(args.filter);
    return graphGet(dPath).then(function(d){
      return{content:[{type:"text",text:(d.value||[]).length?JSON.stringify(d.value,null,2):"No devices found."}]};
    }).catch(function(e){return{content:[{type:"text",text:"list_devices error: "+e.message}]};});
  }
  if(name==="get_sign_in_logs"){
    var lim2=args.limit||25;
    var logPath="/auditLogs/signIns?$top="+encodeURIComponent(lim2)+"&$orderby="+encodeURIComponent("createdDateTime desc")+"&$select=createdDateTime,userDisplayName,userPrincipalName,appDisplayName,ipAddress,status,location";
    if(args.user_id)logPath+="&$filter="+encodeURIComponent("userPrincipalName eq '"+String(args.user_id).replace(/'/g,"''")+"'");
    return graphGet(logPath).then(function(d){
      return{content:[{type:"text",text:(d.value||[]).length?JSON.stringify(d.value,null,2):"No sign-in logs found."}]};
    }).catch(function(e){return{content:[{type:"text",text:"get_sign_in_logs error: "+e.message}]};});
  }

  // ── Phase 1: Teams ────────────────────────────────────────────
  if(name==="list_teams"){
    return graphGet("/groups?$filter=resourceProvisioningOptions/Any(x:x%20eq%20%27Team%27)&$select=id,displayName,description,mail").then(function(d){
      return{content:[{type:"text",text:(d.value||[]).length?JSON.stringify((d.value||[]).map(function(t){return{id:t.id,name:t.displayName,description:t.description};}),null,2):"No Teams found — ensure Team.ReadBasic.All permission is granted."}]};
    }).catch(function(e){return{content:[{type:"text",text:"list_teams error: "+e.message}]};});
  }
  if(name==="list_channels"){
    return graphGet("/teams/"+args.team_id+"/channels?$select=id,displayName,description,membershipType").then(function(d){
      return{content:[{type:"text",text:JSON.stringify((d.value||[]).map(function(c){return{id:c.id,name:c.displayName,type:c.membershipType};}),null,2)}]};
    }).catch(function(e){return{content:[{type:"text",text:"list_channels error: "+e.message}]};});
  }
  if(name==="get_channel_messages"){
    var lim3=args.limit||10;
    return graphGet("/teams/"+args.team_id+"/channels/"+args.channel_id+"/messages?$top="+lim3).then(function(d){
      var msgs=(d.value||[]).map(function(m){return{from:(m.from&&m.from.user&&m.from.user.displayName)||"unknown",time:m.createdDateTime,message:(m.body&&m.body.content||"").replace(/<[^>]+>/g," ").trim().substring(0,300)};});
      return{content:[{type:"text",text:msgs.length?JSON.stringify(msgs,null,2):"No messages found."}]};
    }).catch(function(e){return{content:[{type:"text",text:"get_channel_messages error: "+e.message}]};});
  }
  if(name==="send_channel_message"){
    var wUrl=new URL(TEAMS_WEBHOOK_URL);
    var wBody=JSON.stringify({"@type":"MessageCard","@context":"http://schema.org/extensions","summary":args.message,"themeColor":"0076D7","text":args.message});
    return new Promise(function(resolve,reject){
      var d=Buffer.from(wBody,"utf8");
      var r=https.request({hostname:wUrl.hostname,path:wUrl.pathname+wUrl.search,method:"POST",headers:{"Content-Type":"application/json","Content-Length":d.length}},function(re){var rb="";re.on("data",function(c){rb+=c;});re.on("end",function(){resolve({content:[{type:"text",text:re.statusCode===200?"Message posted to Teams — General channel":"Teams webhook error (HTTP "+re.statusCode+"): "+rb}]});});});
      r.on("error",function(e){resolve({content:[{type:"text",text:"send_channel_message error: "+e.message}]});});
      r.write(d);r.end();
    });
  }

  // ── OneNote Workflows ─────────────────────────────────────────
  if(name==="create_workflow"||name==="list_workflows"){
    var ONENOTE_NOTEBOOK="IT Workflows";
    var SECTION_MAP={cisco_phone:"Cisco Phone Installs",autopilot:"Autopilot Deployments",network:"Network Configuration",printer:"Printer Setup",custom:"Custom Workflows"};
    var TEMPLATES={
      cisco_phone:[
        {heading:"Pre-Installation Checks",items:["Unbox phone and verify model against work order","Confirm MAC address matches deployment sheet","Check PoE switch port is active and tagged to voice VLAN","Verify DHCP scope has available IPs for voice VLAN","Confirm CUCM/UCM has device profile ready for this MAC"]},
        {heading:"Physical Installation",items:["Mount phone bracket on wall or place on desk","Connect ethernet cable from phone to PoE switch port","Connect handset and headset if required","Power on and confirm boot screen appears","Note the IP address displayed during boot"]},
        {heading:"Phone Registration",items:["Confirm phone auto-registers in CUCM","Verify correct extension (DN) is assigned","Test internal call — dial another extension","Test external call — dial out via PSTN","Confirm voicemail button routes correctly"]},
        {heading:"Configuration and Features",items:["Set correct time zone and date/time","Configure speed dials as per user request","Test intercom and call pickup group if configured","Verify BLF keys are working if applicable","Label phone with extension number and user name"]},
        {heading:"Sign-Off",items:["User has confirmed phone is working","Photo taken of installed phone and cable run","Work order updated with MAC, IP, extension, and location","Any issues logged in ticket before closing"]}
      ],
      autopilot:[
        {heading:"Pre-Deployment Checks",items:["Confirm device serial number matches Autopilot import","Verify device is registered in Intune / Autopilot portal","Confirm Autopilot profile is assigned to device or group","Check Wi-Fi or ethernet is available at deployment site","Confirm user M365 licence is active and assigned"]},
        {heading:"Hardware Setup",items:["Unbox device and connect to power","Connect ethernet cable if Wi-Fi not available for OOBE","Do NOT join to local domain — leave for Autopilot","Power on device and wait for Windows OOBE screen","Select region, keyboard layout, confirm network connection"]},
        {heading:"Autopilot Enrollment",items:["At sign-in screen, enter user corporate email address","Wait for Autopilot profile to download","Confirm Setting up for your organisation message appears","Device will restart and apply policies — do NOT interrupt","Wait for all apps to install via Company Portal"]},
        {heading:"Account and Policy Verification",items:["Sign in as end user and confirm MFA prompt completes","Verify OneDrive sync begins automatically","Confirm Outlook connects and mailbox loads","Check Microsoft Teams launches with correct account","Verify VPN client is installed and connects"]},
        {heading:"Peripherals and Final Config",items:["Install and test required peripherals (monitor, dock, printer)","Map required network drives per user role","Confirm all required apps installed from Company Portal","Run Windows Update and install pending updates","Set wallpaper and accessibility settings per user preference"]},
        {heading:"Sign-Off",items:["User has signed in and confirmed device is working","Intune compliance status shows Compliant","Device name noted in work order","Old device collected or decommission ticket raised if applicable"]}
      ]
    };

    function ensureOnenoteNotebook(){
      return getGraphToken().then(function(t){
        return req({hostname:"graph.microsoft.com",path:"/v1.0/users/manueltucker@claudeitagent.onmicrosoft.com/onenote/notebooks",method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}});
      }).then(function(r){
        var nb=(r.body.value||[]).find(function(n){return n.displayName===ONENOTE_NOTEBOOK;});
        if(nb)return nb.id;
        return getGraphToken().then(function(t){
          var b=JSON.stringify({displayName:ONENOTE_NOTEBOOK});
          return req({hostname:"graph.microsoft.com",path:"/v1.0/users/manueltucker@claudeitagent.onmicrosoft.com/onenote/notebooks",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)}},b);
        }).then(function(r){return r.body.id;});
      });
    }

    function ensureOnenoteSection(notebookId,sectionName){
      return getGraphToken().then(function(t){
        return req({hostname:"graph.microsoft.com",path:"/v1.0/users/manueltucker@claudeitagent.onmicrosoft.com/onenote/notebooks/"+notebookId+"/sections",method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}});
      }).then(function(r){
        var sec=(r.body.value||[]).find(function(s){return s.displayName===sectionName;});
        if(sec)return sec.id;
        return getGraphToken().then(function(t){
          var b=JSON.stringify({displayName:sectionName});
          return req({hostname:"graph.microsoft.com",path:"/v1.0/users/manueltucker@claudeitagent.onmicrosoft.com/onenote/notebooks/"+notebookId+"/sections",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)}},b);
        }).then(function(r){return r.body.id;});
      });
    }

    if(name==="list_workflows"){
      return ensureOnenoteNotebook().then(function(nbId){
        return getGraphToken().then(function(t){
          return req({hostname:"graph.microsoft.com",path:"/v1.0/users/manueltucker@claudeitagent.onmicrosoft.com/onenote/notebooks/"+nbId+"/sections",method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}});
        }).then(function(r){
          var sections=(r.body.value||[]);
          return Promise.all(sections.map(function(s){
            return getGraphToken().then(function(t){
              return req({hostname:"graph.microsoft.com",path:"/v1.0/users/manueltucker@claudeitagent.onmicrosoft.com/onenote/sections/"+s.id+"/pages?$select=title,createdDateTime",method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}});
            }).then(function(pr){return{section:s.displayName,pages:(pr.body.value||[]).map(function(p){return{title:p.title,created:p.createdDateTime};})};});
          }));
        }).then(function(results){
          var out=results.filter(function(r){return r.pages.length>0;}).map(function(r){
            return"Section: "+r.section+":\n"+r.pages.map(function(p){return"  - "+p.title+" ("+new Date(p.created).toLocaleDateString()+")";}).join("\n");
          }).join("\n\n");
          return{content:[{type:"text",text:out||"No workflow pages found yet. Use create_workflow to add the first one."}]};
        });
      }).catch(function(e){return{content:[{type:"text",text:"list_workflows error: "+e.message}]};});
    }

    if(name==="create_workflow"){
      var taskType=args.task_type||"custom";
      var sectionName=SECTION_MAP[taskType]||"Custom Workflows";
      var steps=args.steps||(TEMPLATES[taskType]||[{heading:"Steps",items:["Add your steps here"]}]);
      var now=new Date();
      var dateStr=now.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});

      var htmlBody="<!DOCTYPE html><html><head><title>"+args.title+"</title></head><body>";
      htmlBody+="<h1>"+args.title+"</h1>";
      htmlBody+="<p><b>Date:</b> "+dateStr+" &nbsp; <b>Tech:</b> "+(args.tech_name||"—")+" &nbsp; <b>Site:</b> "+(args.site||"—")+"</p>";
      if(args.notes)htmlBody+="<p><b>Notes:</b> "+args.notes+"</p>";
      htmlBody+="<p><b>Status:</b> In Progress</p><hr/>";

      steps.forEach(function(section){
        htmlBody+="<h2>"+section.heading+"</h2>";
        (section.items||[]).forEach(function(item){
          htmlBody+="<p data-tag=\"to-do\">"+item+"</p>";
        });
      });

      htmlBody+="<h2>Field Notes</h2><p>&nbsp;</p><p>&nbsp;</p>";
      htmlBody+="<h2>Job Complete Checklist</h2>";
      htmlBody+="<p data-tag=\"to-do\">All steps completed and verified with user/site contact</p>";
      htmlBody+="<p data-tag=\"to-do\">Photo evidence taken and ready to upload</p>";
      htmlBody+="<p data-tag=\"to-do\">Completion message posted to Teams IT channel</p>";
      htmlBody+="</body></html>";

      return ensureOnenoteNotebook().then(function(nbId){
        return ensureOnenoteSection(nbId,sectionName).then(function(secId){
          return getGraphToken().then(function(t){
            var pageData=Buffer.from(htmlBody,"utf8");
            return new Promise(function(resolve,reject){
              var r=https.request({hostname:"graph.microsoft.com",path:"/v1.0/users/manueltucker@claudeitagent.onmicrosoft.com/onenote/sections/"+secId+"/pages",method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/xhtml+xml","Content-Length":pageData.length}},function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{resolve({status:re.statusCode,body:JSON.parse(d)});}catch(e){resolve({status:re.statusCode,body:d});}});});
              r.on("error",reject);r.write(pageData);r.end();
            });
          }).then(function(r){
            if(r.status===201||r.status===200){
              var pageUrl=(r.body.links&&r.body.links.oneNoteWebUrl&&r.body.links.oneNoteWebUrl.href)||"";
              return{content:[{type:"text",text:"Workflow created: "+args.title+"\nSection: "+sectionName+"\nOpen in OneNote: "+pageUrl+"\n\nShare this link with the field tech. They can tick checkboxes on mobile as they complete each step. When the job is done they should post to the Teams IT channel."}]};
            }
            return{content:[{type:"text",text:"Workflow creation failed (HTTP "+r.status+"): "+JSON.stringify(r.body)}]};
          });
        });
      }).catch(function(e){return{content:[{type:"text",text:"create_workflow error: "+e.message}]};});
    }
  }

  return Promise.resolve({content:[{type:"text",text:"Unknown tool: "+name}]});
}

// Send response as newline-delimited JSON (no Content-Length headers)
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

// Read newline-delimited JSON from stdin
var buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", function(chunk) {
  buf += chunk;
  var lines = buf.split("\n");
  buf = lines.pop();
  lines.forEach(function(line) {
    line = line.trim();
    if (!line) return;
    try {
      var msg = JSON.parse(line);
      handle(msg);
    } catch(e) {
      process.stderr.write("Parse error: " + e.message + " | Line: " + line + "\n");
    }
  });
});

function handle(msg) {
  if (!msg || !msg.method) return;
  if (msg.method === "initialize") {
    send({jsonrpc:"2.0",id:msg.id,result:{
      protocolVersion:"2025-11-25",
      capabilities:{tools:{listChanged:false}},
      serverInfo:{name:"it-knowledge-agent",version:"7.0.0"}
    }});
  } else if (msg.method === "notifications/initialized") {
    // no response
  } else if (msg.method === "tools/list") {
    send({jsonrpc:"2.0",id:msg.id,result:{tools:TOOLS}});
  } else if (msg.method === "tools/call") {
    var name = msg.params && msg.params.name;
    var args = msg.params && msg.params.arguments || {};
    handleTool(name, args).then(function(result) {
      send({jsonrpc:"2.0",id:msg.id,result:result});
    }).catch(function(e) {
      send({jsonrpc:"2.0",id:msg.id,result:{content:[{type:"text",text:"Error: "+e.message}]}});
    });
  } else if (msg.id !== undefined) {
    send({jsonrpc:"2.0",id:msg.id,result:{}});
  }
}

process.stderr.write("IT Knowledge Agent v7.0 started\n");