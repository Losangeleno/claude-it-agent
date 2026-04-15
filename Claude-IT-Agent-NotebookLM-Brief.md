# Claude IT Support Agent — System Architecture & Implementation Brief
**Prepared for NotebookLM Analysis | April 2026**

---

## 1. Purpose of This Document

This document is a complete technical brief of a custom Claude-powered IT Support Agent system. It describes what the system is trying to do, how it is currently built, what is working, what is not working, and exactly what the desired output should look like.

The goal of this analysis is to identify the specific impediments preventing the system from producing the desired output and to recommend a clear, implementable solution.

---

## 2. What We Are Trying to Build

### 2.1 The Vision

A unified IT Support Agent that works identically across three surfaces:

- The Claude desktop app (Cowork mode) — for the IT manager
- A deployed web app at a public Azure URL — for field technicians on mobile phones
- Microsoft Teams chat — for field techs submitting questions from job sites

### 2.2 Desired Behavior

When a field tech or IT staff member asks ANY IT question (e.g. "How do I install a Cisco phone?"), the system should:

1. Search the SharePoint Knowledge Base for the matching runbook (e.g. RB-010)
2. Read the full article content from SharePoint
3. Format the response with: [HIGH CONFIDENCE] label, Article ID, Category, Severity
4. Return the complete step-by-step procedure with numbered phases, checkboxes, warnings, tips
5. Auto-create a OneNote checklist page the tech can tick on their phone
6. Include the OneNote page URL in the response
7. End with: Source: RB-010 — Cisco IP Phone Installation

### 2.3 DESIRED Output Example

```
[HIGH CONFIDENCE]
Article ID: RB-010 | Category: Hardware | Severity: Medium

Summary: Step-by-step field checklist for installing and registering a Cisco IP phone.

Before You Start:
Confirm MAC address, PoE switch port, and CUCM device profile before going on site.

Phase 1 — Pre-Installation Checks
[ ] Unbox phone and verify model against work order
[ ] Confirm MAC address matches deployment sheet
[ ] Check PoE switch port is active and tagged to voice VLAN
[ ] Verify DHCP scope has available IPs for voice VLAN
[ ] Confirm CUCM device profile is ready for this MAC

Phase 2 — Physical Installation
[ ] Mount bracket and place phone on desk or wall
[ ] Connect ethernet cable to PoE switch port
[ ] Connect handset cable to phone base
[ ] Power on and confirm boot screen appears
[ ] Note the IP address displayed during boot

Phase 3 — Phone Registration
[ ] Confirm phone registers in CUCM (Device > Phone, search by MAC)
[ ] Verify correct extension (DN) is assigned and visible on screen
[ ] Test internal call — dial another extension, confirm audio both ways
[ ] Test external call via PSTN — confirm audio both ways
[ ] Confirm voicemail button routes correctly

Phase 4 — Configuration
[ ] Set correct time zone and date/time
[ ] Configure speed dials as per user request
[ ] Test intercom and call pickup group if configured
[ ] Verify BLF keys if applicable
[ ] Label phone with extension number and user name

Phase 5 — Sign-Off
[ ] User confirmed phone is working
[ ] Photo taken of installation and cable run
[ ] Work order updated with MAC, IP, extension, and location
[ ] Post completion to Teams IT channel

---
OneNote Workflow Created:
https://onenote.com/... (live checklist link for field tech)

Source: RB-010 — Cisco IP Phone Installation
```

### 2.4 CURRENT (Unwanted) Output

```
[LOW CONFIDENCE]
Article ID: N/A | Category: CISCO Hardware | Severity: Low

I could not find a specific KB article for this topic.

NOTE: I searched the KB and CISCO support documentation but could not find a
direct match for: Cisco phone install workflow

Steps to resolve:
1. Visit the manufacturer support site directly
2. Search for your exact model number and Windows version
3. Download the latest driver from the official site

Escalation: Raise a ticket at https://itportal.yourorg.com or call ext. 1234

Source: General IT best practice (no KB article found)
```

---

## 3. System Architecture

### 3.1 Components

| Component | Technology | Role |
|---|---|---|
| MCP Tool Server | server.js (Node.js, local) | Local MCP server for Claude desktop. Exposes tools: search_kb, read_file, create_workflow, send_email, list_workflows, etc. |
| Web App | app.js (Node.js on Azure Container Apps) | Public web interface at Azure URL. Has its own tool routing and response formatting. Does NOT use Claude API. |
| Knowledge Base | SharePoint (claudeitagent.sharepoint.com/sites/ITKnowledgeBase) | Libraries: FAQs, Runbooks, Troubleshooting, Assets, Scripts, Cabling. KB articles are .md files. |
| OneNote | Microsoft OneNote via Graph API | IT Workflows notebook with sections per task type. Pages have checkboxes for field techs. |
| Azure AD App (Graph) | App ID: 9c823e8e-5ce1-480c-8240-e19f6b23512e | Service principal for Graph API. Has SharePoint, Teams, Intune, and OneNote (Notes.ReadWrite.All) permissions. |
| Authentication | Client Credentials (app-only token) | Cannot use /me endpoints — must use /users/{upn}/ for user-specific resources like OneNote. |
| Teams | Microsoft Teams Webhook + Graph API | Webhook URL for posting messages to IT channel. Graph API for reading/sending channel messages. |
| Claude Desktop | Cowork mode + CLAUDE.md | CLAUDE.md at C:\claude-it-agent\ controls IT agent behavior. Claude AI handles all reasoning and formatting. |
| GitHub | github.com/Losangeleno/claude-it-agent | Source code repository. Push does NOT auto-deploy — deploy.ps1 must be run manually. |
| Azure Container Apps | eastus region | Hosts the web app container. Rebuilt with deploy.ps1 using Azure Container Registry. |

### 3.2 The Critical Difference Between Desktop and Web App

This is the most important architectural issue in the system:

**Claude Desktop (Cowork):**
- Uses Claude AI (Anthropic) to reason, understand intent, call tools, and format responses
- CLAUDE.md system prompt defines the response format, KB search priority, and confidence labels
- Claude decides which tool to call, reads the result, and formats a complete intelligent response
- Works correctly when KB articles exist

**Web App (Azure URL):**
- Does NOT use Claude AI at all
- Uses a hardcoded JavaScript function called routeChat() that matches keywords to tools
- Uses processArticle() to extract sections from KB markdown by keyword scoring
- Uses formatChatResponse() to produce formatted output from tool results
- Any change to behavior requires code edits, git commit, git push, and manual redeploy (10-15 min cycle)
- Cannot reason about intent, only pattern-match keywords

### 3.3 Data Flow — Web App

```
User types message
       |
routeChat(message) — keyword matching
       |
handleTool(toolName, args) — calls SharePoint Graph API
       |
       ├─ If search_kb returns file list → readAndRespond() → processArticle() → sendResponse()
       ├─ If search_kb returns "Auto-synced" → sync vendor docs → re-search → readAndRespond() OR fallback
       ├─ If search_kb returns "No results" → sync vendor docs → re-search → readAndRespond() OR fallback
       └─ Other tools → formatChatResponse()
```

### 3.4 Data Flow — Claude Desktop

```
User types message
       |
Claude reads CLAUDE.md system prompt
       |
Claude decides to call search_kb tool
       |
search_kb searches SharePoint — returns file list
       |
Claude calls read_file on the top result
       |
Claude reads full article content
       |
Claude formats response following CLAUDE.md rules:
  - Confidence label ([HIGH/MEDIUM/LOW CONFIDENCE])
  - Article ID, Category, Severity header
  - Summary, Notes, Steps, Expected Results, Source
       |
Claude optionally calls create_workflow to create OneNote page
```

---

## 4. Impediments — Why the Web App Is Not Working

### 4.1 KB Articles Not Found (Primary Problem)

**What happens:** User asks "Cisco phone install workflow" → web app returns LOW CONFIDENCE generic response instead of RB-010 content.

**Root Cause 1 — SharePoint search indexing lag:**
SharePoint's full-text search index takes 10-20 minutes to index newly uploaded files. RB-010 and RB-011 were uploaded recently. The search_kb tool uses SharePoint search, which may not yet return these files.

**Root Cause 2 — Search term mismatch:**
The search query is built from the user's message. "Cisco phone install workflow" does not strongly match the filename "RB-010-Cisco-Phone-Installation.md". SharePoint full-text search requires overlap between query terms and document content/filename.

**Root Cause 3 — Wrong routing path:**
The code detects "cisco" as a vendor keyword and routes through sync_vendor_docs (which syncs Cisco PSIRT security advisories) before searching KB. This is the wrong path for an internal runbook query.

**Root Cause 4 — Fallback too aggressive:**
When the KB search fails, the code immediately falls to a generic "no KB article found" response rather than trying alternative search terms (like "RB-010", "phone installation", or listing the Runbooks library directly).

### 4.2 Web App Has No Claude Intelligence

The web app and Claude desktop produce different quality responses because one uses Claude AI and one uses hardcoded JavaScript.

**Impact:**
- Response quality depends entirely on how well processArticle() scores and extracts markdown sections
- The system prompt designed in NotebookLM (confidence labels, article IDs, callouts, source citations) must be manually reimplemented as JavaScript string templates
- Changes that work naturally in Claude desktop require code changes in the web app
- The web app cannot understand context, follow-up questions, or handle ambiguous queries

### 4.3 OneNote — Multiple Blocking Issues

**Issue A: Permission — RESOLVED April 15, 2026**
The Azure AD app now has Notes.ReadWrite.All application permission granted with admin consent.

**Issue B: Wrong API endpoint — Partially resolved**
The Graph API code used /me/onenote which fails with app-only (client credentials) authentication. Updated to /users/manueltucker@claudeitagent.onmicrosoft.com/onenote. Claude desktop must be restarted to pick up this change in server.js.

**Issue C: OneNote desktop app rejects the work account — ACTIVE BLOCKER**
The OneNote desktop app (standalone Windows app) shows:
- Error code: 0xE0000024 bdf5h
- Message: "You can't sign in here with a work or school account. Use your personal account instead."
- ManuelTucker@ClaudeITAgent.onmicrosoft.com is a Microsoft 365 tenant account
- The standalone OneNote desktop app only accepts personal Microsoft accounts (outlook.com, hotmail.com)

This means even if the Graph API creates an IT Workflows notebook, field techs CANNOT open it in the standalone OneNote desktop app with this account.

**Workarounds to evaluate:**
- Access OneNote via browser at onenote.com — supports M365 work accounts
- Embed OneNote as a tab inside the Microsoft Teams IT channel
- Use the Microsoft 365 version of OneNote (installed with Office 365) rather than the standalone Windows Store app
- Replace OneNote entirely with a SharePoint checklist page, Teams Adaptive Card, or Microsoft Planner task list

**Key finding:** The oneNoteWebUrl returned by the Graph API opens in a browser and DOES support work accounts. So delivering the OneNote link as a browser URL (not requiring the desktop app) may still work for field techs on mobile.

### 4.4 No Auto-Deployment Pipeline

Every code change to app.js requires:
1. Code edit
2. git add + git commit + git push
3. Run deploy.ps1 (builds Docker container, pushes to Azure Container Registry, updates Container App)
4. Wait 3-5 minutes for Azure rebuild

There is no GitHub Actions workflow. The .github/workflows directory does not exist.

### 4.5 Response Format Only Partially Implemented in Web App

The confidence labels, article IDs, category, severity, and source citation are now implemented in the web app. However, the article content extraction (processArticle function) uses a keyword-scoring algorithm that:
- May miss phases that are in the runbook
- Truncates content at 3500 characters
- Cannot reliably extract checkbox lists
- Does not preserve the structured format of the runbook

---

## 5. What Is Currently Working

| Status | Item |
|---|---|
| WORKING | Claude desktop searches KB, reads articles, formats responses with full confidence labels when articles exist |
| WORKING | SharePoint KB has RB-010 (Cisco Phone Install) and RB-011 (Autopilot Deployment) as structured markdown |
| WORKING | OneNote Notes.ReadWrite.All permission granted |
| WORKING | Web app detects Cisco/Autopilot query type and attempts OneNote creation in parallel |
| WORKING | New quick-start chips live on web app: Cisco phone install workflow, Autopilot new device setup, AD password reset, VPN not connecting, Printer not showing up, M365 service health |
| WORKING | deploy.ps1 rebuilds and redeploys Azure Container App |
| WORKING | CLAUDE.md updated with full NotebookLM-designed system prompt |
| WORKING | Teams webhook configured and posting messages to IT channel |
| WORKING | Response format implemented in web app: [CONFIDENCE] label, Article ID, Category, Severity, Source |

---

## 6. Knowledge Base Content

### 6.1 Libraries
- FAQs — Common end-user questions
- Runbooks — Step-by-step IT procedures (RB series)
- Troubleshooting — Issue resolution guides, vendor docs auto-synced from Microsoft Learn
- Assets — Hardware inventory and software licenses
- Scripts — PowerShell and automation scripts
- Cabling — Network and physical infrastructure docs

### 6.2 Articles

| Article ID | Title | Description |
|---|---|---|
| KB-001 | AD Password Reset | Self-service and IT-assisted password reset |
| KB-002 | Shared Drive Access | Requesting access to drives and SharePoint |
| KB-003 | VPN (Cisco AnyConnect) | Remote access VPN setup and troubleshooting |
| KB-004 | Wi-Fi Configuration | Corporate and guest Wi-Fi setup |
| KB-005 | Laptop Boot Issues | Hardware diagnostics for power failures |
| KB-006 | Device Procurement | Requesting new or replacement hardware |
| KB-007 | Software Installation | Company Portal and Self Service |
| KB-008 | Unapproved Software | Process for non-standard software requests |
| KB-009 | Phishing Response | Immediate actions after clicking phishing link |
| KB-010 | Outlook Troubleshooting | Fixing sync and Offline status |
| KB-011 | Printer Troubleshooting | Shared printer not showing or printing |
| RB-001 to RB-005 | Operational Runbooks | Onboarding, offboarding, outage, rollback |
| RB-010 | Cisco Phone Installation | 5-phase field checklist — NEWLY ADDED |
| RB-011 | Autopilot Deployment | 6-phase field checklist — NEWLY ADDED |

### 6.3 KB Gaps (No Articles Yet)
- Mobile Device Management (MDM) and BYOD
- Microsoft Teams troubleshooting
- Conference room AV equipment
- OneDrive and SharePoint end-user guides
- Docking station and monitor setup
- SaaS application support
- Cybersecurity awareness

---

## 7. Key File Locations

| File | Path | Purpose |
|---|---|---|
| MCP Server | C:\claude-it-agent\server.js | Local tool server loaded by Claude desktop |
| Web App | C:\claude-it-agent\app.js | Azure Container App source |
| System Prompt | C:\claude-it-agent\CLAUDE.md | Cowork mode instructions |
| Deploy Script | C:\claude-it-agent\deploy.ps1 | Rebuilds and redeploys to Azure |
| OneNote Script | C:\claude-it-agent\add-onenote-permission.ps1 | Grants Notes.ReadWrite.All |
| GitHub | https://github.com/Losangeleno/claude-it-agent | Source code |
| Web App URL | https://claude-it-agent.whitestone-6cbe99bc.eastus.azurecontainerapps.io/chat | Live web UI |
| SharePoint KB | https://claudeitagent.sharepoint.com/sites/ITKnowledgeBase | Knowledge base |
| Azure AD App ID | 9c823e8e-5ce1-480c-8240-e19f6b23512e | Graph/Teams/OneNote app |
| Tenant ID | e876d5db-a9f8-4e71-abc1-dcee4d8b0578 | Azure AD tenant |

---

## 8. Questions for NotebookLM

### 8.1 How should the web app find KB articles reliably?

SharePoint full-text search has indexing delays and keyword matching issues. What is the best approach?

- Option A: List the Runbooks library directly (by filename) and match without search
- Option B: Cache a keyword-to-article-ID lookup table in app.js itself
- Option C: Fetch known articles by direct SharePoint drive path (no search needed)
- Option D: Add the Anthropic Claude API to app.js so Claude handles all routing

### 8.2 Should the web app use the Claude API?

The fundamental quality gap between the desktop and web app could be eliminated by adding an Anthropic API call to app.js. What would this require and what are the trade-offs?

### 8.3 How should KB articles be structured for reliable extraction?

The processArticle() function scores markdown sections. What article structure produces the most reliable extraction of step-by-step content?

### 8.4 How should the Teams field chat integration work?

Field techs want to submit IT questions via Teams and receive step-by-step responses with OneNote links on mobile. What is the optimal architecture?

### 8.5 What is the right CI/CD strategy?

Currently every code change requires a manual deploy.ps1 run. How should the GitHub Actions workflow be structured to auto-deploy on push?

---

## 9. The Single Most Important Fix

**Replace the hardcoded routeChat() function in app.js with a Claude API call.**

The web app and the Claude desktop app behave differently because one uses Claude AI and one does not. Adding the Anthropic API to app.js with the same system prompt from CLAUDE.md would make both surfaces identical in quality. The hardcoded routing, keyword matching, and format templates could be replaced with a single Claude API call that handles everything intelligently — exactly as the desktop app does today.

This is the root cause of all response quality issues on the web app.

---

*Generated April 15, 2026. Upload this file to NotebookLM along with CLAUDE.md, RB-010, and RB-011 for comprehensive analysis.*
