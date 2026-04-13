const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, TabStopType, TabStopPosition
} = require('docx');
const fs = require('fs');

// ── Palette ───────────────────────────────────────────────────────────────────
const NAVY      = "1E3A5F";
const NAVY_MID  = "2E5280";
const SILVER    = "7F9EB2";
const ROW_A     = "EEF2FB";
const ROW_B     = "FFFFFF";
const HDR_TXT   = "FFFFFF";
const KEY_TXT   = "1E3A5F";
const BODY_TXT  = "333333";
const RULE_CLR  = "C5D0DC";
const NOTE_BG   = "E8F0FE";   // soft blue info box

// Section accent fills
const SEC_BLUE  = "E3F2FD";   // What We Do
const SEC_GREEN = "E8F5E9";   // What We've Built
const SEC_AMBER = "FFF8E1";   // What We Can Do
const SEC_ROSE  = "FCE4EC";   // Equipment tiers – Advanced
const SEC_TEAL  = "E0F2F1";   // Microsoft Ecosystem
const SEC_PURP  = "F3E5F5";   // How We Work

const TIER_FOUND  = "E8F5E9"; const TIER_FOUND_K = "1B5E20";
const TIER_MID    = "FFF3E0"; const TIER_MID_K   = "E65100";
const TIER_ADV    = "FCE4EC"; const TIER_ADV_K   = "880E4F";
const MS_L1       = "E3F2FD"; const MS_L1_K      = "0D47A1";
const MS_L2       = "E8F5E9"; const MS_L2_K      = "1B5E20";
const MS_L3       = "FFF3E0"; const MS_L3_K      = "E65100";
const MS_L4       = "FCE4EC"; const MS_L4_K      = "880E4F";

// ── Borders ───────────────────────────────────────────────────────────────────
const hair = { style: BorderStyle.SINGLE, size: 1, color: RULE_CLR };
const CB   = { top: hair, bottom: hair, left: hair, right: hair };
const nb   = { style: BorderStyle.NONE,  size: 0, color: "FFFFFF" };
const NB   = { top: nb,   bottom: nb,   left: nb,   right: nb };

// ── Helpers ───────────────────────────────────────────────────────────────────
const sp = (after = 200) => new Paragraph({ spacing: { after } });

function hCell(text, width) {
  return new TableCell({
    borders: CB, width: { size: width, type: WidthType.DXA },
    shading: { fill: NAVY, type: ShadingType.CLEAR },
    margins: { top: 110, bottom: 110, left: 150, right: 150 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, font: "Arial", size: 20, bold: true, color: HDR_TXT })] })]
  });
}

function dCell(text, fill, width, bold = false, color = BODY_TXT, sz = 19) {
  return new TableCell({
    borders: CB, width: { size: width, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 90, bottom: 90, left: 150, right: 150 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, font: "Arial", size: sz, bold, color })] })]
  });
}

function accentCell(text, fill, keyCol, width) {
  return new TableCell({
    borders: { top: hair, bottom: hair, right: hair, left: { style: BorderStyle.SINGLE, size: 14, color: keyCol } },
    width: { size: width, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 90, bottom: 90, left: 150, right: 150 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, font: "Arial", size: 18, bold: true, color: keyCol })] })]
  });
}

function sectionHeading(text) {
  return new Paragraph({
    spacing: { before: 360, after: 140 },
    border: { left: { style: BorderStyle.SINGLE, size: 22, color: NAVY, space: 8 } },
    children: [new TextRun({ text, font: "Arial", size: 28, bold: true, color: NAVY })]
  });
}

function subHeading(text, color = NAVY_MID) {
  return new Paragraph({
    spacing: { before: 260, after: 120 },
    border: { left: { style: BorderStyle.SINGLE, size: 10, color: SILVER, space: 6 } },
    children: [new TextRun({ text, font: "Arial", size: 22, bold: true, color })]
  });
}

function introPara(text) {
  return new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({ text, font: "Arial", size: 19, color: "555555", italics: true })]
  });
}

function infoBox(title, body, fillColor = NOTE_BG, keyColor = NAVY) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: { top: { style: BorderStyle.SINGLE, size: 4, color: keyColor }, bottom: hair, left: { style: BorderStyle.SINGLE, size: 14, color: keyColor }, right: hair },
      width: { size: 9360, type: WidthType.DXA },
      shading: { fill: fillColor, type: ShadingType.CLEAR },
      margins: { top: 160, bottom: 160, left: 240, right: 240 },
      children: [
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: title, font: "Arial", size: 21, bold: true, color: keyColor })] }),
        new Paragraph({ children: [new TextRun({ text: body, font: "Arial", size: 19, color: "444444" })] }),
      ]
    })]})],
  });
}

// ── Title band ────────────────────────────────────────────────────────────────
function titleBand() {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [
      new TableRow({ children: [new TableCell({ borders: NB, width: { size: 9360, type: WidthType.DXA }, shading: { fill: SILVER, type: ShadingType.CLEAR }, margins: { top: 36, bottom: 36, left: 0, right: 0 }, children: [new Paragraph({ children: [new TextRun({ text: "", size: 4 })] })] })]}),
      new TableRow({ children: [new TableCell({ borders: NB, width: { size: 9360, type: WidthType.DXA }, shading: { fill: NAVY, type: ShadingType.CLEAR }, margins: { top: 300, bottom: 80, left: 400, right: 400 }, children: [new Paragraph({ children: [new TextRun({ text: "IT Services & Intelligent Systems Support", font: "Arial", size: 52, bold: true, color: HDR_TXT })] })] })]}),
      new TableRow({ children: [new TableCell({ borders: NB, width: { size: 9360, type: WidthType.DXA }, shading: { fill: NAVY, type: ShadingType.CLEAR }, margins: { top: 0, bottom: 60, left: 400, right: 400 }, children: [new Paragraph({ children: [new TextRun({ text: "Capabilities Profile  \u00b7  Services Overview  \u00b7  Technology Coverage", font: "Arial", size: 24, color: "BDD1E8" })] })] })]}),
      new TableRow({ children: [new TableCell({ borders: NB, width: { size: 9360, type: WidthType.DXA }, shading: { fill: NAVY, type: ShadingType.CLEAR }, margins: { top: 0, bottom: 320, left: 400, right: 400 }, children: [new Paragraph({ children: [new TextRun({ text: "Field diagnostics  \u00b7  AI-powered knowledge management  \u00b7  Microsoft 365  \u00b7  Multi-vendor enterprise support", font: "Arial", size: 18, color: "8AAEC8", italics: true })] })] })]}),
    ]
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────

// 1. WHAT WE DO — Core service areas
const coreServices = [
  ["Field Diagnostics & Troubleshooting",  "On-site and remote troubleshooting for desktop computers, laptops, printers, scanners, and network equipment across multiple manufacturers"],
  ["AI-Assisted Scenario Building",         "Complex field problems are submitted in plain English; the system cross-references five live manufacturer sources simultaneously to produce a structured diagnostic report"],
  ["Knowledge Management",                  "A self-growing SharePoint IT Knowledge Base with six libraries, automatically updated nightly from Cisco, Microsoft, Dell, HP, and Fujitsu sources"],
  ["Microsoft 365 Support",                 "Full Microsoft 365 ecosystem coverage \u2014 from Windows 11 field issues up through Exchange Online, SharePoint, Teams, Power Automate, and Azure Graph API"],
  ["Security Advisory Monitoring",          "Live Cisco PSIRT feed monitored continuously \u2014 CVE severity, affected versions, and patch urgency surfaced automatically when relevant to a field problem"],
  ["Automation & Workflow",                 "Power Automate cloud flows capture IT knowledge passively from email and Teams, feeding the knowledge base without manual effort"],
  ["Network Cabling & Infrastructure",      "Structured cabling installation and documentation to T568B standard \u2014 jack termination, patch panel wiring, and continuity verification"],
  ["Documentation & Runbooks",              "Field-ready reference documents, colour-coded guides, and step-by-step runbooks generated on demand and stored in the knowledge base"],
];

// 2. WHAT WE'VE BUILT
const builtItems = [
  ["IT Knowledge Base",          "SharePoint Online",            "Six-library repository: FAQs, Troubleshooting, Runbooks, Assets, Scripts, Cabling \u2014 nightly automated refresh from 5 vendor sources"],
  ["AI Agent Server",            "Node.js + Model Context Protocol", "12-tool MCP server connecting an AI assistant to live enterprise data: SharePoint, Cisco PSIRT, M365 health, Dell, HP, Fujitsu"],
  ["Field Scenario Builder",     "MCP tool \u2014 build_scenario",     "Takes a plain-English problem, extracts keywords, runs parallel queries across all sources, returns a structured diagnostic report"],
  ["Nightly Refresh Engine",     "Windows Task Scheduler",       "Runs at 2 AM daily \u2014 6 automated source pulls, markdown generation, SharePoint upload, with error logging"],
  ["Email-to-KB Flow",           "Power Automate cloud flow",    "Monitors a designated mailbox \u2014 tagged emails are automatically parsed and uploaded to the correct SharePoint library"],
  ["Teams-to-KB Flow",           "Power Automate cloud flow",    "Field techs react to any Teams message with a bookmark \u2014 the thread is captured and saved as a new KB entry automatically"],
  ["Microsoft Graph Integration","Azure AD OAuth2 + Graph API",  "Authenticated connection to SharePoint, Exchange, M365 service health, and planned maintenance endpoints"],
  ["Cisco PSIRT Integration",    "Cisco API OAuth2",             "Live CVE feed for IOS XE, Catalyst 9000, SD-WAN, ISE, and Wireless \u2014 severity, version, and patch urgency parsed in real time"],
  ["T568B Cabling Document",     "Word / docx generation",       "Colour-coded field reference for network jack punch-down, pair assignments, and T568B wiring sequence \u2014 generated programmatically"],
];

// 3. WHAT WE CAN DO — Capabilities
const capabilities = [
  ["Instant Field Scenario Report",   "Describe any IT problem in plain English \u2014 receive a structured report with Quick Checks, Manufacturer Findings, layered Test Scenarios, and Escalation Path",   "On demand, real time"],
  ["Live Security Advisory Check",    "Query current Cisco CVEs against a specific platform or device \u2014 severity rating, affected versions, and recommended action returned immediately",                "On demand, real time"],
  ["M365 Service Health Check",       "Query Microsoft 365 for active incidents or degradations affecting Exchange, Teams, SharePoint, or OneDrive \u2014 distinguishes outage from local fault",           "On demand, real time"],
  ["Knowledge Base Search",           "Natural-language search across all six SharePoint KB libraries simultaneously \u2014 returns matched articles, runbooks, and guides",                               "On demand"],
  ["Knowledge Base Article Upload",   "Any field resolution, procedure, or guide can be saved directly to the correct SharePoint library in a single command \u2014 no manual steps",                      "On demand"],
  ["Nightly Content Refresh",         "KB stays current automatically \u2014 Cisco advisories, Microsoft Learn, Dell, HP, and Fujitsu support content updated every night without human action",           "Automated, nightly"],
  ["Email & Teams Knowledge Capture", "New IT knowledge from daily communication is captured passively \u2014 tagged emails and bookmarked Teams messages flow into the KB automatically",                  "Automated, continuous"],
  ["T568B Field Reference",           "Colour-coded wiring document generated on demand for field techs \u2014 includes punch-down layout, pair assignments, and jack wiring sequence",                    "On demand"],
  ["Custom Troubleshooting Runbooks", "Step-by-step runbooks created, formatted, and uploaded to SharePoint for any device, procedure, or recurring fault type",                                           "On demand"],
];

// 4. EQUIPMENT COVERAGE BY TIER
const tierFoundational = [
  ["Network Cabling",    "TIA-568B standard",                    "T568B jack termination, patch panel wiring, RJ-45 crimping, continuity testing, damaged-jack replacement procedures"],
  ["Desktop Computers",  "Dell OptiPlex 3000\u20137000",                "Windows 11 driver installs, chipset/BIOS updates, F12 boot diagnostics, no-boot triage, performance troubleshooting"],
  ["Laptop Computers",   "Dell Latitude 5000\u20137000",                "Wi-Fi adapter failures, Windows Hello 24H2 regression, docking station faults, screen/display driver issues"],
  ["Basic Printers",     "HP OfficeJet Pro 8610 / 9010",         "Driver reinstall, wireless re-pairing, scan-to-computer failure (HP Print and Scan Doctor workflow), firmware update"],
];
const tierIntermediate = [
  ["Document Scanners",  "Fujitsu ScanSnap iX500 / iX1500 / iX1600",  "WIA service restart, ScanSnap Manager legacy driver, Windows 11 24H2 USB recognition regression, ScanSnap Home migration"],
  ["Production Scanners","Fujitsu fi-7160 / fi-7180 / fi-8170",        "TWAIN driver vs PaperStream IP selection, network scan setup, firmware update, PFU/Ricoh driver portal navigation"],
  ["Laser MFPs",         "HP Color LaserJet Pro MFP 3301 / 3302sdw",   "Print-works-but-not-scan fault, enterprise print queue config, toner/maintenance alerts, HP Smart Diagnostics"],
  ["Microsoft 365",      "Exchange Online / Teams / SharePoint",        "Email NDR codes (5.7.x), Teams presence faults, SharePoint permission errors, M365 service outage vs local fault isolation"],
  ["Workstations",       "Dell Precision 3000\u20135000",               "OS reinstall via Dell backup media, GPU driver conflict, memory diagnostic (ePSA), multi-monitor display driver"],
];
const tierAdvanced = [
  ["Cisco Switches",     "Catalyst 9300 / 9500X / 9600X",        "IOS XE vulnerability assessment, DHCP snooping DoS, Secure Boot bypass, privilege escalation chain (CVE-2026-20114 + CVE-2026-20110)"],
  ["Cisco SD-WAN",       "Catalyst SD-WAN (IOS XE)",              "February 2026 SD-WAN advisory remediation, overlay policy faults, control-plane connectivity, vManage health"],
  ["Cisco Identity",     "Cisco ISE",                             "Security advisory correlation, policy node health, certificate expiry, RADIUS authentication failure chain"],
  ["Live CVE Lookup",    "Cisco PSIRT API \u2014 all platforms",        "Real-time CVE severity, affected version detection, patch urgency (CVSS scoring), advisory content fetch"],
  ["Cross-Vendor Faults","Dell + Cisco + Microsoft + HP + Fujitsu","Multi-device scenario: network path analysis, M365 health overlay, simultaneous manufacturer advisory check, escalation path"],
];

// 5. MICROSOFT ECOSYSTEM COVERAGE (4 levels)
const msLevels = [
  { level: "Level 1  \u2014  Field (Windows 11)", fill: MS_L1, key: MS_L1_K,
    rows: [
      ["Windows 11 Driver Management",  "Chipset, BIOS, Wi-Fi, GPU, and peripheral drivers; Dell support portal navigation; SFC/DISM repair"],
      ["Boot & Startup Diagnostics",    "F12 One Time Boot, WinRE, Safe Mode; no-boot triage; Dell ePSA hardware diagnostic"],
      ["Windows 11 Update Issues",      "24H2 regression identification (Dell Latitude Windows Hello, Fujitsu scanner USB); rollback procedures"],
      ["Device & Peripheral Setup",     "USB device recognition, printer/scanner driver install, docking station configuration, display drivers"],
    ]
  },
  { level: "Level 2  \u2014  Microsoft 365 (Exchange, Teams, SharePoint)", fill: MS_L2, key: MS_L2_K,
    rows: [
      ["Exchange Online",               "NDR code diagnosis (5.7.501 outbound spam block, 550 delivery failures); mail flow troubleshooting; tenant reputation"],
      ["SharePoint Online",             "Library architecture and permissions; document upload via Graph API; column configuration; KB structure design"],
      ["Microsoft Teams",               "Presence fault isolation; reaction-based automation triggers; channel knowledge capture via Power Automate"],
      ["M365 Admin & Service Health",   "Service health dashboard; active incident vs local fault distinction; planned maintenance monitoring via API"],
    ]
  },
  { level: "Level 3  \u2014  Power Automate & Automation", fill: MS_L3, key: MS_L3_K,
    rows: [
      ["Cloud Flow Design",             "Email trigger flows, Teams reaction flows, conditional routing by content type, SharePoint file creation actions"],
      ["Passive Knowledge Capture",     "Email-to-KB flow monitors a mailbox; Teams bookmark captures message threads \u2014 both upload to SharePoint automatically"],
      ["Flow Troubleshooting",          "Run history analysis, action failure diagnosis, connector permission resolution, trigger condition tuning"],
      ["Automation Architecture",       "Designed a passive capture pipeline that grows the KB without manual IT staff effort \u2014 continuous improvement by default"],
    ]
  },
  { level: "Level 4  \u2014  Azure AD & Microsoft Graph API", fill: MS_L4, key: MS_L4_K,
    rows: [
      ["Azure App Registration",        "Enterprise app registered in Azure AD; client ID, tenant ID, and secret configured; redirect URIs and token endpoints"],
      ["OAuth2 Client Credentials Flow","Programmatic token acquisition; secure credential storage; token refresh handling in Node.js MCP server"],
      ["Graph API \u2014 Mail & SharePoint",  "mail.Send via Graph; SharePoint drive file PUT; content-type headers; LIBRARY_DRIVES mapping for 6 libraries"],
      ["Graph API \u2014 Service Health",    "OData-filtered queries for active M365 incidents and planned maintenance; encoded filter parameters for API compatibility"],
    ]
  },
];

// 6. HOW WE WORK
const methodology = [
  ["1", "Problem Input",         "Describe the issue in plain English \u2014 device model, symptom, and what has already been tried"],
  ["2", "Instant KB Search",     "The knowledge base is queried across all six libraries for matching articles and past resolutions"],
  ["3", "Live Manufacturer Pull","Real-time content fetched from the relevant vendor \u2014 Dell, HP, Fujitsu, Cisco, or Microsoft Learn"],
  ["4", "Health & Security Check","M365 service health queried; Cisco CVEs cross-referenced if network equipment is involved"],
  ["5", "Report Delivered",      "Structured output returned: Quick Checks \u2192 Manufacturer Findings \u2192 Test Scenarios \u2192 Escalation Path"],
  ["6", "Resolution Captured",   "Successful resolutions saved directly to the KB \u2014 the system gets smarter with every field case"],
];

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT
// ─────────────────────────────────────────────────────────────────────────────
const doc = new Document({
  styles: { default: { document: { run: { font: "Arial", size: 22, color: BODY_TXT } } } },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
    headers: {
      default: new Header({ children: [new Paragraph({
        spacing: { after: 0 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 6 } },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          new TextRun({ text: "IT Services & Intelligent Systems Support  \u2014  Capabilities Profile", font: "Arial", size: 16, color: SILVER }),
          new TextRun({ text: "\tApril 2026", font: "Arial", size: 16, color: SILVER }),
        ]
      })] })
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 6 } },
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "Powered by IT Knowledge Agent  \u00b7  Page ", font: "Arial", size: 16, color: SILVER }),
          new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: SILVER }),
          new TextRun({ text: " of ", font: "Arial", size: 16, color: SILVER }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Arial", size: 16, color: SILVER }),
        ]
      })] })
    },

    children: [

      // TITLE
      titleBand(),
      sp(360),

      // ── 1. WHAT WE DO ─────────────────────────────────────────────────────
      sectionHeading("What We Do"),
      introPara("We provide enterprise-grade IT support backed by a live AI agent system \u2014 combining hands-on field diagnostics with an intelligent knowledge base that draws from manufacturer APIs, security feeds, and Microsoft 365 in real time. Every service below is supported by live tooling, not just experience."),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [2960, 6400],
        rows: [
          new TableRow({ children: [hCell("Service Area", 2960), hCell("What It Means in Practice", 6400)] }),
          ...coreServices.map(([svc, desc], i) => new TableRow({ children: [
            dCell(svc,  i % 2 === 0 ? ROW_A : ROW_B, 2960, true, KEY_TXT),
            dCell(desc, i % 2 === 0 ? ROW_A : ROW_B, 6400),
          ]}))
        ]
      }),
      sp(360),

      // ── 2. WHAT WE'VE BUILT ───────────────────────────────────────────────
      sectionHeading("What We\u2019ve Built"),
      introPara("The infrastructure below powers every service we offer. It was designed, coded, and deployed from scratch \u2014 each component independently configured and tested against live enterprise APIs."),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [2280, 2160, 4920],
        rows: [
          new TableRow({ children: [hCell("System", 2280), hCell("Technology", 2160), hCell("Description", 4920)] }),
          ...builtItems.map(([sys, tech, desc], i) => new TableRow({ children: [
            dCell(sys,  i % 2 === 0 ? SEC_GREEN : ROW_B, 2280, true, KEY_TXT),
            dCell(tech, i % 2 === 0 ? SEC_GREEN : ROW_B, 2160, false, "555555"),
            dCell(desc, i % 2 === 0 ? SEC_GREEN : ROW_B, 4920),
          ]}))
        ]
      }),
      sp(360),

      // ── 3. WHAT WE CAN DO ─────────────────────────────────────────────────
      sectionHeading("What We Can Do"),
      introPara("The following capabilities are available on demand \u2014 either through the AI agent directly or through the automated infrastructure running continuously in the background:"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [2560, 5080, 1720],
        rows: [
          new TableRow({ children: [hCell("Capability", 2560), hCell("What You Get", 5080), hCell("Delivery", 1720)] }),
          ...capabilities.map(([cap, what, delivery], i) => new TableRow({ children: [
            dCell(cap,      i % 2 === 0 ? SEC_AMBER : ROW_B, 2560, true, KEY_TXT),
            dCell(what,     i % 2 === 0 ? SEC_AMBER : ROW_B, 5080),
            dCell(delivery, i % 2 === 0 ? SEC_AMBER : ROW_B, 1720, false, "555555"),
          ]}))
        ]
      }),
      sp(360),

      // ── 4. EQUIPMENT COVERAGE ─────────────────────────────────────────────
      sectionHeading("Equipment & Systems We Support"),
      introPara("Support spans three tiers of complexity. The AI agent automatically identifies the appropriate tier from the problem description and directs queries to the relevant manufacturer source."),

      subHeading("Tier 1 \u2014 Foundational  (network cabling \u00b7 desktops \u00b7 basic peripherals)"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [1100, 1720, 2280, 4260],
        rows: [
          new TableRow({ children: [hCell("Tier", 1100), hCell("Category", 1720), hCell("Equipment / Models", 2280), hCell("Scenarios Supported", 4260)] }),
          ...tierFoundational.map(([cat, models, scenarios], i) => new TableRow({ children: [
            accentCell("Foundational", i%2===0 ? TIER_FOUND:"#F1F8F1", TIER_FOUND_K, 1100),
            dCell(cat,       i%2===0 ? TIER_FOUND:"#F1F8F1", 1720, true, KEY_TXT),
            dCell(models,    i%2===0 ? TIER_FOUND:"#F1F8F1", 2280, false, "444444"),
            dCell(scenarios, i%2===0 ? TIER_FOUND:"#F1F8F1", 4260),
          ]}))
        ]
      }),
      sp(200),

      subHeading("Tier 2 \u2014 Intermediate  (document scanners \u00b7 MFPs \u00b7 Microsoft 365 \u00b7 workstations)"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [1100, 1720, 2280, 4260],
        rows: [
          new TableRow({ children: [hCell("Tier", 1100), hCell("Category", 1720), hCell("Equipment / Models", 2280), hCell("Scenarios Supported", 4260)] }),
          ...tierIntermediate.map(([cat, models, scenarios], i) => new TableRow({ children: [
            accentCell("Intermediate", i%2===0 ? TIER_MID:"#FFFBF0", TIER_MID_K, 1100),
            dCell(cat,       i%2===0 ? TIER_MID:"#FFFBF0", 1720, true, KEY_TXT),
            dCell(models,    i%2===0 ? TIER_MID:"#FFFBF0", 2280, false, "444444"),
            dCell(scenarios, i%2===0 ? TIER_MID:"#FFFBF0", 4260),
          ]}))
        ]
      }),
      sp(200),

      subHeading("Tier 3 \u2014 Advanced  (Cisco infrastructure \u00b7 live CVE correlation \u00b7 cross-vendor)"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [1100, 1720, 2280, 4260],
        rows: [
          new TableRow({ children: [hCell("Tier", 1100), hCell("Category", 1720), hCell("Equipment / Models", 2280), hCell("Scenarios Supported", 4260)] }),
          ...tierAdvanced.map(([cat, models, scenarios], i) => new TableRow({ children: [
            accentCell("Advanced", i%2===0 ? TIER_ADV:"#FDF0F5", TIER_ADV_K, 1100),
            dCell(cat,       i%2===0 ? TIER_ADV:"#FDF0F5", 1720, true, KEY_TXT),
            dCell(models,    i%2===0 ? TIER_ADV:"#FDF0F5", 2280, false, "444444"),
            dCell(scenarios, i%2===0 ? TIER_ADV:"#FDF0F5", 4260),
          ]}))
        ]
      }),
      sp(360),

      // ── 5. MICROSOFT ECOSYSTEM ────────────────────────────────────────────
      sectionHeading("Microsoft Ecosystem Coverage"),
      introPara("Microsoft support spans four distinct levels \u2014 from Windows 11 field issues handled daily by technicians, up through enterprise automation and Azure developer tooling. Most practitioners operate at one or two levels. This practice covers all four."),

      ...msLevels.flatMap(({ level, fill, key, rows }) => [
        subHeading(level, key),
        new Table({
          width: { size: 9360, type: WidthType.DXA }, columnWidths: [2760, 6600],
          rows: [
            new TableRow({ children: [hCell("Area", 2760), hCell("What Was Done / What We Handle", 6600)] }),
            ...rows.map(([area, detail], i) => new TableRow({ children: [
              dCell(area,   i%2===0 ? fill : ROW_B, 2760, true, key),
              dCell(detail, i%2===0 ? fill : ROW_B, 6600),
            ]}))
          ]
        }),
        sp(200),
      ]),
      sp(160),

      // ── 6. HOW WE WORK ────────────────────────────────────────────────────
      sectionHeading("How We Work"),
      introPara("Every field engagement follows the same six-step process \u2014 from problem intake through to resolution capture. The system handles steps 2\u20135 automatically; the technician focuses on step 1 and step 6."),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [440, 2000, 6920],
        rows: [
          new TableRow({ children: [hCell("#", 440), hCell("Step", 2000), hCell("What Happens", 6920)] }),
          ...methodology.map(([num, step, what], i) => new TableRow({ children: [
            dCell(num,  i%2===0 ? SEC_TEAL : ROW_B, 440,  true, "00695C"),
            dCell(step, i%2===0 ? SEC_TEAL : ROW_B, 2000, true, KEY_TXT),
            dCell(what, i%2===0 ? SEC_TEAL : ROW_B, 6920),
          ]}))
        ]
      }),
      sp(360),

      // ── CLOSING INFO BOX ─────────────────────────────────────────────────
      infoBox(
        "Accessible Anywhere \u2014 Desktop & Mobile",
        "All services are delivered through cloud infrastructure. The SharePoint Knowledge Base, AI agent interface, and Power Automate flows are accessible from any web browser \u2014 including smartphones and tablets. There is no local server, no VPN requirement, and no desktop dependency. The system works wherever the technician is.",
        NOTE_BG, NAVY
      ),
      sp(200),
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('C:\\claude-it-agent\\IT-Capabilities-Profile.docx', buf);
  console.log('Done: C:\\claude-it-agent\\IT-Capabilities-Profile.docx');
}).catch(err => { console.error(err); process.exit(1); });
