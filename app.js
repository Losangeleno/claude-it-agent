const https = require("https");
const http  = require("http");

const TENANT_ID     = "e876d5db-a9f8-4e71-abc1-dcee4d8b0578";
const CLIENT_ID     = "50d28fcf-1e66-452f-be81-36b40b640605";
const CLIENT_SECRET = "OCy8Q~qnTAqtSfK.8bIdnKVqcCv46zMFGkIhQbtc";
const TENANT_NAME   = "ClaudeITAgent";
const SITE_NAME     = "ITKnowledgeBase";
const CISCO_KEY     = "qtbj2x2knjbmewmnt3kss8hy";
const CISCO_SECRET  = "g7MRPgWGBPdaKcAQTuxDGqBB";
const PORT          = 3000;

let spToken=null,spExpiry=0,ciscoToken=null,ciscoExpiry=0,siteId=null,cachedDrives=[];

function req(o,b){return new Promise(function(res,rej){var r=https.request(o,function(re){var d="";re.on("data",function(c){d+=c;});re.on("end",function(){try{res({status:re.statusCode,body:JSON.parse(d)});}catch(e){res({status:re.statusCode,body:d});}});});r.on("error",rej);if(b)r.write(b);r.end();});}

function getSPToken(){if(spToken&&Date.now()<spExpiry)return Promise.resolve(spToken);var b="grant_type=client_credentials&client_id="+encodeURIComponent(CLIENT_ID)+"&client_secret="+encodeURIComponent(CLIENT_SECRET)+"&scope="+encodeURIComponent("https://graph.microsoft.com/.default");return req({hostname:"login.microsoftonline.com",path:"/"+TENANT_ID+"/oauth2/v2.0/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(b)}},b).then(function(r){spToken=r.body.access_token;spExpiry=Date.now()+(r.body.expires_in-60)*1000;return spToken;});}

function getCiscoToken(){if(ciscoToken&&Date.now()<ciscoExpiry)return Promise.resolve(ciscoToken);var b="grant_type=client_credentials&client_id="+encodeURIComponent(CISCO_KEY)+"&client_secret="+encodeURIComponent(CISCO_SECRET);return req({hostname:"id.cisco.com",path:"/oauth2/default/v1/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(b)}},b).then(function(r){ciscoToken=r.body.access_token;ciscoExpiry=Date.now()+3500000;return ciscoToken;});}

function graph(path){return getSPToken().then(function(t){return req({hostname:"graph.microsoft.com",path:"/v1.0"+path,method:"GET",headers:{Authorization:"Bearer "+t}});}).then(function(r){return r.body;});}

function getSiteId(){if(siteId)return Promise.resolve(siteId);return graph("/sites/"+TENANT_NAME+".sharepoint.com:/sites/"+SITE_NAME+":").then(function(d){siteId=d.id;return siteId;});}

function getDrives(){if(cachedDrives.length)return Promise.resolve(cachedDrives);return getSiteId().then(function(id){return graph("/sites/"+id+"/drives");}).then(function(d){cachedDrives=d.value||[];return cachedDrives;});}

function handleQuery(action,params){
  if(action==="search_kb"){return getSiteId().then(function(id){return graph("/sites/"+id+"/drive/root/search(q='"+encodeURIComponent(params.query)+"')");}).then(function(d){var r=(d.value||[]).slice(0,8).map(function(f){return{name:f.name,id:f.id,driveId:f.parentReference&&f.parentReference.driveId,library:f.parentReference&&f.parentReference.name};});return r.length?JSON.stringify(r,null,2):"No results for: "+params.query;});}
  if(action==="ms_service_health"){return graph("/admin/serviceAnnouncement/issues?$filter=status ne 'resolved'&$top=10").then(function(d){var issues=(d.value||[]).map(function(i){return{title:i.title,service:i.service,status:i.status,severity:i.classification};});return issues.length?"Active issues:\n"+JSON.stringify(issues,null,2):"All Microsoft 365 services healthy!";}); }
  if(action==="cisco_advisories"){return getCiscoToken().then(function(t){return req({hostname:"apix.cisco.com",path:"/security/advisories/v2/product?product="+encodeURIComponent(params.product),method:"GET",headers:{Authorization:"Bearer "+t,Accept:"application/json"}});}).then(function(r){var a=(r.body.advisories||[]).slice(0,5).map(function(a){return{title:a.advisoryTitle,severity:a.sir,cves:a.cves};});return a.length?JSON.stringify(a,null,2):"No advisories for: "+params.product;}).catch(function(e){return"Cisco error: "+e.message;});}
  if(action==="list_library"){return getDrives().then(function(drives){var drive=drives.find(function(d){return d.name.toLowerCase()===(params.library||"").toLowerCase();});if(!drive)return"Available libraries: "+drives.map(function(d){return d.name;}).join(", ");return graph("/drives/"+drive.id+"/root/children").then(function(d){return JSON.stringify((d.value||[]).map(function(f){return{name:f.name,id:f.id,driveId:drive.id};}),null,2);});});}
  if(action==="read_file"){return graph("/drives/"+params.drive_id+"/items/"+params.item_id).then(function(meta){var url=meta["@microsoft.graph.downloadUrl"];if(!url)return"Cannot download.";var u=new URL(url);return new Promise(function(resolve,reject){https.get({hostname:u.hostname,path:u.pathname+u.search},function(res){var d="";res.on("data",function(c){d+=c;});res.on("end",function(){resolve(d.substring(0,8000));});}).on("error",reject);});});}
  return Promise.resolve("Unknown action: "+action);
}

const server = http.createServer(function(reqHttp,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(reqHttp.method==="OPTIONS"){res.writeHead(200);res.end();return;}
  if(reqHttp.url==="/"&&reqHttp.method==="GET"){
  var fs=require("fs");
  var htmlPath="C:\\claude-it-agent\\index.html";
  if(fs.existsSync(htmlPath)){
    res.writeHead(200,{"Content-Type":"text/html"});
    res.end(fs.readFileSync(htmlPath,"utf8"));
  } else {
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify({status:"IT Knowledge Agent v4.0 Running"}));
  }
  return;
}
  if(reqHttp.url==="/health"){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({status:"healthy",time:new Date().toISOString()}));return;}
  if(reqHttp.url==="/query"&&reqHttp.method==="POST"){var body="";reqHttp.on("data",function(c){body+=c;});reqHttp.on("end",function(){try{var data=JSON.parse(body);handleQuery(data.action||"search_kb",data.params||{}).then(function(result){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({success:true,result:result}));}).catch(function(e){res.writeHead(500,{"Content-Type":"application/json"});res.end(JSON.stringify({success:false,error:e.message}));});} catch(e){res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({success:false,error:"Invalid JSON"}));}});return;}
  res.writeHead(404,{"Content-Type":"application/json"});res.end(JSON.stringify({error:"Not found"}));
});

server.listen(PORT,function(){console.log("IT Knowledge Agent running on port "+PORT);});
