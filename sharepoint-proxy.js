const { ConfidentialClientApplication } = require("@azure/msal-node");
const TENANT_ID = process.env.SP_TENANT_ID;
const CLIENT_ID = process.env.SP_CLIENT_ID;
const CLIENT_SECRET = process.env.SP_CLIENT_SECRET;
const SHAREPOINT_HOST = process.env.SP_HOST || "claudeitagent.sharepoint.com";
const SITE_PATH = process.env.SP_SITE_PATH || "/sites/ITKnowledgeBase";
let msalClient = null;
function getMsalClient() {
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication({
      auth: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, authority: "https://login.microsoftonline.com/" + TENANT_ID }
    });
  }
  return msalClient;
}
async function getAccessToken() {
  const result = await getMsalClient().acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] });
  if (!result || !result.accessToken) throw new Error("Failed to acquire access token");
  return result.accessToken;
}
async function getSiteId(token) {
  const fetch = (await import("node-fetch")).default;
  const res = await fetch("https://graph.microsoft.com/v1.0/sites/" + SHAREPOINT_HOST + ":" + SITE_PATH, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error("Failed to get site ID: " + res.status);
  return (await res.json()).id;
}
async function searchKB(query) {
  try {
    const fetch = (await import("node-fetch")).default;
    const token = await getAccessToken();
    const res = await fetch("https://graph.microsoft.com/v1.0/search/query", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ entityTypes: ["driveItem"], query: { queryString: query }, from: 0, size: 10, region: "NAM" }] })
    });
    if (!res.ok) throw new Error("Graph search failed: " + res.status);
    const data = await res.json();
    const hits = (data && data.value && data.value[0] && data.value[0].hitsContainers && data.value[0].hitsContainers[0] && data.value[0].hitsContainers[0].hits) || [];
    if (hits.length === 0) return { source: "SharePoint KB", query: query, results: [], message: "No results for: " + query };
    return { source: "SharePoint KB", query: query, results: hits.map(function(h,i){ return { rank: i+1, title: (h.resource && h.resource.name) || "Untitled", summary: h.summary || "", url: (h.resource && h.resource.webUrl) || "" }; }), count: hits.length };
  } catch(err) {
    return { source: "SharePoint KB", query: query, error: true, message: err.message, results: [] };
  }
}
async function listLibraries() {
  try {
    const fetch = (await import("node-fetch")).default;
    const token = await getAccessToken();
    const siteId = await getSiteId(token);
    const res = await fetch("https://graph.microsoft.com/v1.0/sites/" + siteId + "/drives", { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) throw new Error("Failed to list libraries: " + res.status);
    const data = await res.json();
    return { source: "SharePoint KB", libraries: (data.value||[]).map(function(d){ return { name: d.name, webUrl: d.webUrl }; }) };
  } catch(err) {
    return { source: "SharePoint KB", error: true, message: err.message };
  }
}
function validateConfig() {
  var missing = ["SP_TENANT_ID","SP_CLIENT_ID","SP_CLIENT_SECRET"].filter(function(k){ return !process.env[k]; });
  if (missing.length) { console.warn("SP proxy missing env vars:", missing.join(", ")); return false; }
  console.log("SharePoint proxy configured for", SHAREPOINT_HOST + SITE_PATH);
  return true;
}
module.exports = { searchKB, listLibraries, validateConfig };