const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, TabStopType, TabStopPosition
} = require('docx');
const fs = require('fs');

// ── Palette ───────────────────────────────────────────────────────────────────
const NAVY     = "1E3A5F";
const NAVY_MID = "2E5280";
const SILVER   = "7F9EB2";
const ROW_A    = "EEF2FB";
const ROW_B    = "FFFFFF";
const HDR_TXT  = "FFFFFF";
const KEY_TXT  = "1E3A5F";
const BODY_TXT = "333333";
const NOTE_BG  = "FFF8E1";
const RULE_CLR = "C5D0DC";

// Tier accent colours
const TIER_FOUND  = "E8F5E9";  // soft green  – Foundational
const TIER_FOUND_K= "1B5E20";
const TIER_MID    = "FFF3E0";  // soft amber  – Intermediate
const TIER_MID_K  = "E65100";
const TIER_ADV    = "FCE4EC";  // soft rose   – Advanced
const TIER_ADV_K  = "880E4F";

const PIPE_BG  = "E3F2FD";     // light blue  – pipeline steps
const PIPE_K   = "0D47A1";
const KB_BG    = "F3E5F5";     // light purple – KB libraries
const KB_K     = "4A148C";
const BUILD_BG = "E8EAF6";     // periwinkle  – build complexity
const BUILD_K  = "1A237E";

// ── Borders ───────────────────────────────────────────────────────────────────
const hair = { style: BorderStyle.SINGLE, size: 1, color: RULE_CLR };
const CB   = { top: hair, bottom: hair, left: hair, right: hair };
const nb   = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NB   = { top: nb, bottom: nb, left: nb, right: nb };

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

// Tier badge cell – coloured left band, label only
function tierCell(label, fill, keyCol, width) {
  return new TableCell({
    borders: {
      top: hair, bottom: hair, right: hair,
      left: { style: BorderStyle.SINGLE, size: 14, color: keyCol }
    },
    width: { size: width, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 90, bottom: 90, left: 150, right: 150 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text: label, font: "Arial", size: 18, bold: true, color: keyCol })] })]
  });
}

function sectionHeading(text) {
  return new Paragraph({
    spacing: { before: 360, after: 140 },
    border: { left: { style: BorderStyle.SINGLE, size: 22, color: NAVY, space: 8 } },
    children: [new TextRun({ text, font: "Arial", size: 28, bold: true, color: NAVY })]
  });
}

function subHeading(text) {
  return new Paragraph({
    spacing: { before: 260, after: 120 },
    border: { left: { style: BorderStyle.SINGLE, size: 10, color: SILVER, space: 6 } },
    children: [new TextRun({ text, font: "Arial", size: 22, bold: true, color: NAVY_MID })]
  });
}

function introPara(text) {
  return new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({ text, font: "Arial", size: 19, color: "555555", italics: true })]
  });
}

// ── Title band ────────────────────────────────────────────────────────────────
function titleBand() {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [
      new TableRow({ children: [new TableCell({
        borders: NB, width: { size: 9360, type: WidthType.DXA },
        shading: { fill: SILVER, type: ShadingType.CLEAR },
        margins: { top: 36, bottom: 36, left: 0, right: 0 },
        children: [new Paragraph({ children: [new TextRun({ text: "", size: 4 })] })]
      })]}),
      new TableRow({ children: [new TableCell({
        borders: NB, width: { size: 9360, type: WidthType.DXA },
        shading: { fill: NAVY, type: ShadingType.CLEAR },
        margins: { top: 300, bottom: 80, left: 400, right: 400 },
        children: [new Paragraph({ children: [new TextRun({ text: "AI Agent Engineering", font: "Arial", size: 60, bold: true, color: HDR_TXT })] })]
      })]}),
      new TableRow({ children: [new TableCell({
        borders: NB, width: { size: 9360, type: WidthType.DXA },
        shading: { fill: NAVY, type: ShadingType.CLEAR },
        margins: { top: 0, bottom: 60, left: 400, right: 400 },
        children: [new Paragraph({ children: [new TextRun({ text: "Professional Skills & Equivalent Certifications", font: "Arial", size: 27, color: "BDD1E8" })] })]
      })]}),
      new TableRow({ children: [new TableCell({
        borders: NB, width: { size: 9360, type: WidthType.DXA },
        shading: { fill: NAVY, type: ShadingType.CLEAR },
        margins: { top: 0, bottom: 320, left: 400, right: 400 },
        children: [new Paragraph({ children: [new TextRun({ text: "Enterprise AI integration  \u00b7  Microsoft 365 automation  \u00b7  Multi-vendor field diagnostics  \u00b7  Knowledge management systems", font: "Arial", size: 18, color: "8AAEC8", italics: true })] })]
      })]}),
    ]
  });
}

// ── Amber note box ────────────────────────────────────────────────────────────
function noteBox() {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: { top: { style: BorderStyle.SINGLE, size: 4, color: "E8A000" }, bottom: hair, left: { style: BorderStyle.SINGLE, size: 14, color: "E8A000" }, right: hair },
      width: { size: 9360, type: WidthType.DXA },
      shading: { fill: NOTE_BG, type: ShadingType.CLEAR },
      margins: { top: 180, bottom: 180, left: 240, right: 240 },
      children: [
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "Note on Field Relevance", font: "Arial", size: 22, bold: true, color: "7A5000" })] }),
        new Paragraph({ children: [new TextRun({ text: "Most formal courses do not yet cover enterprise AI agent engineering at this level. The skills applied here \u2014 MCP server development, live API orchestration, multi-vendor troubleshooting automation, and self-growing knowledge bases \u2014 represent an emerging discipline. This project places the practitioner well ahead of current curriculum in most certification programs.", font: "Arial", size: 19, color: "5A4000", italics: true })] }),
      ]
    })]})],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA TABLES
// ─────────────────────────────────────────────────────────────────────────────

// 1. What Was Built
const whatWasBuilt = [
  ["MCP Agent Server",                   "Custom Node.js server using Model Context Protocol \u2014 12 tools connecting AI to live enterprise data sources in real time"],
  ["SharePoint IT Knowledge Base",       "Six-library SharePoint site: FAQs, Runbooks, Troubleshooting, Assets, Scripts, Cabling \u2014 nightly refresh from 5 manufacturer sources"],
  ["Microsoft Graph API Integration",    "OAuth2 app registration with admin-consented permissions for mail, SharePoint, and M365 service health endpoints"],
  ["Cisco PSIRT Integration",            "Live CVE and security advisory feed \u2014 monitors Cisco IOS XE, Catalyst 9000, SD-WAN, ISE, and Wireless platforms"],
  ["Field Scenario Builder",             "The centrepiece tool \u2014 takes a plain-English field problem and returns a structured, multi-source diagnostic report within seconds"],
  ["Nightly KB Refresh Engine",          "Automated pipeline pulling from Cisco, Microsoft Learn, Dell, HP (Ricoh), and Fujitsu every night at 2 AM without human intervention"],
  ["Power Automate Flows",               "Email-to-KB and Teams reaction-to-KB flows \u2014 knowledge is captured passively from daily team communication"],
  ["HP & Fujitsu Support Integration",   "DuckDuckGo search + direct page fetch for HP support and PFU/Ricoh scanner portals; strips HTML and stores plain-text content"],
  ["T568B Cabling Documentation",        "Colour-coded Word document generated for field techs covering T568B punch-down layout, pair assignments, and jack wiring sequence"],
  ["Web-Based Access (Desktop & Mobile)","All components run on cloud infrastructure \u2014 accessible via any browser; SharePoint, Power Automate, and the agent interface all support mobile"],
];

// 2. Equipment Coverage by Tier
// Columns: Tier | Category | Models / Products | Common Scenarios Handled
const equipment = [
  // Foundational
  { tier: "Foundational", tFill: TIER_FOUND, tKey: TIER_FOUND_K,
    rows: [
      ["Network Cabling",        "Standards-based (TIA-568B)",         "T568B punch-down layout, RJ-45 jack termination, patch panel wiring, continuity testing, damaged-jack replacement"],
      ["Desktop Computers",      "Dell OptiPlex 3000\u20137000 series",        "Windows 11 driver installs, chipset/BIOS updates, slow performance (F12 diagnostics), no-boot triage"],
      ["Laptop Computers",       "Dell Latitude 5000\u20137000 series",        "Wi-Fi adapter failures, Windows Hello PIN/fingerprint issues (24H2 regression), docking station faults"],
      ["Basic Printers",         "HP OfficeJet Pro 8610 / 9010",       "Driver reinstall, wireless re-pairing, scan-to-computer failure (HP Print and Scan Doctor workflow)"],
    ]
  },
  // Intermediate
  { tier: "Intermediate", tFill: TIER_MID, tKey: TIER_MID_K,
    rows: [
      ["Document Scanners",      "Fujitsu ScanSnap iX500 / iX1500 / iX1600",  "Windows 11 WIA service restart, ScanSnap Manager legacy driver install, 24H2 USB recognition regression"],
      ["Production Scanners",    "Fujitsu fi-7160 / fi-7180 / fi-8170",        "TWAIN driver conflicts, PaperStream IP vs. ScanSnap Manager selection, network scanning setup, firmware update"],
      ["Laser MFPs",             "HP Color LaserJet Pro MFP 3301 / 3302sdw",   "Print-works-but-not-scan fault, firmware update, enterprise print queue configuration, toner/maintenance alerts"],
      ["Microsoft 365",          "Exchange Online / Teams / SharePoint",        "Email delivery NDR codes (5.7.x), Teams presence issues, SharePoint permission errors, M365 service outage correlation"],
      ["Dell Workstations",      "Dell Precision 3000\u20135000 series",       "OS reinstall via Dell backup media, GPU driver conflict, memory diagnostic, multi-monitor display driver"],
    ]
  },
  // Advanced
  { tier: "Advanced", tFill: TIER_ADV, tKey: TIER_ADV_K,
    rows: [
      ["Cisco Network Switches",    "Cisco Catalyst 9300 / 9500X / 9600X",   "IOS XE vulnerability assessment, DHCP snooping DoS (CVE-2026-series), Secure Boot bypass, privilege escalation chain (CVE-2026-20114 + CVE-2026-20110)"],
      ["Cisco SD-WAN",              "Cisco Catalyst SD-WAN (IOS XE)",         "Remediation of February 2026 SD-WAN security advisory, overlay policy faults, control-plane connectivity"],
      ["Cisco Identity Services",   "Cisco ISE",                              "Security advisory correlation, policy node health, certificate expiry, RADIUS authentication failure chain"],
      ["Live CVE Correlation",      "Cisco PSIRT API \u2014 all platforms",         "Real-time CVE severity lookup, affected version detection, patch urgency assessment, CVSS scoring integration"],
      ["Cross-Vendor Fault Isolation","Dell + Cisco + Microsoft + HP",        "Multi-device scenario: network path analysis, M365 service health overlay, simultaneous manufacturer advisory check, structured escalation path"],
    ]
  },
];

// 3. How a Scenario Is Generated (pipeline)
const pipeline = [
  ["1", "Problem Input",          "Plain-English description from field tech (e.g. \u201cScanSnap not recognised after Windows 11 update\u201d)",  "Field technician"],
  ["2", "Keyword Extraction",     "Stopword filter strips filler words; meaningful terms isolated (device model, symptom, vendor)",              "MCP server \u2014 Node.js"],
  ["3", "KB Search",              "SharePoint knowledge base queried across all 6 libraries simultaneously for matching articles",              "Microsoft Graph API"],
  ["4", "Manufacturer Data Pull", "Live content fetched: Cisco PSIRT advisories, MS Learn, Dell support, HP support, Fujitsu/PFU/Ricoh portal", "5 vendor APIs + web fetch"],
  ["5", "M365 Health Check",      "Real-time Microsoft 365 service health queried \u2014 active incidents or degradations surfaced immediately",    "Microsoft Graph \u2014 ServiceHealth"],
  ["6", "Security Advisory Cross-Reference","Cisco CVEs matched against detected device type and platform version for vulnerability correlation", "Cisco PSIRT OAuth2 API"],
  ["7", "Report Assembly",        "Structured output generated: Quick Checks \u2192 Manufacturer Findings \u2192 Layered Test Scenarios \u2192 Escalation Path", "MCP build_scenario tool"],
];

// 4. Knowledge Base Architecture
const kbLibraries = [
  ["FAQs",            "Common question-answer pairs, manufacturer how-to guides, Microsoft Learn articles, Dell and HP support summaries",  "Nightly automated refresh"],
  ["Troubleshooting", "Cisco security advisories, HP printer/scanner guides, Fujitsu scanner fault trees, Dell hardware diagnostics",       "Nightly automated refresh"],
  ["Runbooks",        "M365 service health status, planned maintenance windows, step-by-step remediation procedures",                       "Nightly + real-time M365"],
  ["Assets",          "Device inventory records, hardware specs, deployed firmware versions, warranty status entries",                      "Manual / Power Automate"],
  ["Scripts",         "Diagnostic scripts, driver install sequences, automation snippets for common field tasks",                           "Manual upload"],
  ["Cabling",         "T568B wiring diagrams, colour-coded punch-down guides, patch panel layouts, structured cabling standards",           "Manual upload"],
];

const kbGrowth = [
  ["Email Capture Flow",    "Power Automate monitors a designated mailbox \u2014 any email tagged as IT knowledge is automatically parsed and uploaded to the correct SharePoint library"],
  ["Teams Reaction Flow",   "Field techs react to any Teams message with a bookmark emoji \u2014 Power Automate captures the message thread and saves it to the KB as a new troubleshooting entry"],
  ["Nightly Refresh Engine","Scheduled task runs at 2 AM daily: queries Cisco PSIRT, MS Learn, Dell.com, HP support, and Fujitsu/PFU portal \u2014 writes updated markdown files to SharePoint"],
  ["Field Scenario Feedback","Scenario outputs can be saved directly to the KB with a single command \u2014 field-tested procedures become permanent KB entries"],
];

// 5. Technical Build Complexity
const buildComplexity = [
  ["Azure AD App Registration",   "Azure Active Directory + OAuth2",        "Client credentials flow with admin-consented Graph API permissions \u2014 the secure backbone all tools depend on"],
  ["MCP Server (12 tools)",       "Node.js + Model Context Protocol",        "Async parallel query handler; live HTTP fetch with HTML stripping; keyword extraction; structured markdown assembly"],
  ["Cisco PSIRT API",             "OAuth2 token + REST JSON feed",           "Live CVE ingestion, severity parsing (CVSS), affected-version detection, advisory URL content fetch"],
  ["Dell / HP / Fujitsu Fetch",   "DuckDuckGo Instant Answer API + HTTPS",  "Search API for current support URLs; direct HTTPS page fetch; HTML stripping via regex tag removal; maxLen truncation"],
  ["Microsoft Graph \u2014 Health","Graph API \u2014 admin.microsoft.com",   "OData-encoded filter queries for active incidents and planned maintenance; encoded characters (%20, %27) for API compatibility"],
  ["SharePoint KB Upload",        "Graph API \u2014 Files.ReadWrite.All",    "Drive ID mapping for 6 libraries; binary PUT to SharePoint document library with content-type and filename headers"],
  ["Power Automate Flows",        "Microsoft Power Platform cloud flows",    "Email trigger on category; Teams reaction trigger; SharePoint file creation action; conditional routing by content type"],
  ["Nightly Refresh Scheduler",   "Windows Task Scheduler + Node.js",       "6-source pipeline in sequence; markdown file generation; SharePoint upload per source; error logging to .log file"],
];

// 6. Certifications
const certifications = [
  ["Microsoft Certified: Azure Solutions Architect Expert", "Core",        "Azure AD, Graph API, OAuth2, API permissions \u2014 the exact stack used to build the agent backend"],
  ["Microsoft Certified: Power Platform Functional Consultant", "Supporting","Power Automate flows, SharePoint integration, and the KB automation pipelines"],
  ["Microsoft 365 Certified: Administrator Expert",         "Supporting",  "M365 tenant admin, Exchange Online, SharePoint, Teams \u2014 the KB infrastructure foundation"],
  ["Node.js Application Developer (OpenJS Foundation)",     "Supporting",  "Server-side JavaScript \u2014 the MCP agent server, API handlers, and nightly refresh scripts"],
  ["CompTIA Network+",                                      "Supporting",  "Structured cabling, T568B wiring, and network troubleshooting \u2014 the field skills demonstrated"],
];

// 7. Skills
const skills = [
  ["Azure AD & App Registrations",    "Registered enterprise apps, configured OAuth2 client credentials, granted API permissions with admin consent"],
  ["Microsoft Graph API",             "Authenticated API calls for mail, SharePoint, M365 service health, and planned maintenance endpoints"],
  ["SharePoint Knowledge Management", "Designed and populated a 6-library IT KB with automated nightly refresh from manufacturer APIs"],
  ["Power Automate",                  "Cloud flows capturing emails and Teams messages into the KB automatically \u2014 no manual intervention"],
  ["AI Agent Development (MCP)",      "Full MCP server in Node.js connecting AI to 12 live enterprise tools and data sources"],
  ["Cisco PSIRT API",                 "Live CVE feed integration for real-time vulnerability monitoring across 5 Cisco product lines"],
  ["Multi-Vendor Field Diagnostics",  "Scenario builder cross-referencing Dell, HP, Fujitsu, Cisco, and Microsoft live content simultaneously"],
  ["Structured Cabling (T568B)",      "Industry-standard T568B wiring for network jack termination and patch panel documentation"],
];

// 8. How to Describe
const howToDescribe = [
  ["Resume / LinkedIn",   "Designed and deployed an enterprise AI agent system integrating Microsoft 365, SharePoint, and manufacturer APIs (Cisco, Dell, HP, Fujitsu) using Node.js and Model Context Protocol (MCP)"],
  ["Job Interview",       "I built a hands-on enterprise AI system that can take any IT problem from the field and instantly cross-reference five manufacturer data sources, live security advisories, and an internal knowledge base to generate a structured troubleshooting plan"],
  ["Casual Conversation", "I built an AI tool that an IT tech can describe a problem to \u2014 like a broken scanner or a Cisco switch issue \u2014 and it pulls from manufacturer support sites, Microsoft, and Cisco security feeds to tell them exactly what to check"],
  ["Technical Audience",  "Built a full MCP server in Node.js with OAuth2 Graph API integration, parallel async multi-vendor content fetch, Cisco PSIRT CVE correlation, and a self-growing SharePoint KB fed by Power Automate and nightly scheduled refresh"],
];

// 9. Accessibility
const accessibility = [
  ["SharePoint Knowledge Base",  "Fully web-based \u2014 accessible at sharepoint.com on any browser, desktop or mobile"],
  ["IT Agent (MCP Tools)",       "Cloud-connected service \u2014 usable from any device with internet access via the Cowork desktop or mobile interface"],
  ["Power Automate Flows",       "Cloud-hosted automation \u2014 runs independently 24/7 with no desktop required; managed at make.powerautomate.com"],
  ["Nightly KB Refresh",         "Scheduled task runs automatically each night \u2014 no human action required; pulls live data from all 5 manufacturer sources"],
  ["Mobile Device Support",      "SharePoint, Power Automate, and the Cowork agent interface all have fully functional mobile web and app experiences"],
];

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT BUILD
// ─────────────────────────────────────────────────────────────────────────────
const doc = new Document({
  styles: { default: { document: { run: { font: "Arial", size: 22, color: BODY_TXT } } } },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
      }
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        spacing: { after: 0 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 6 } },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          new TextRun({ text: "AI Agent Engineering  \u2014  Professional Skills & Equivalent Certifications", font: "Arial", size: 16, color: SILVER }),
          new TextRun({ text: "\tApril 2026", font: "Arial", size: 16, color: SILVER }),
        ]
      })] })
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 6 } },
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "Generated by IT Knowledge Agent  \u00b7  Page ", font: "Arial", size: 16, color: SILVER }),
          new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: SILVER }),
          new TextRun({ text: " of ", font: "Arial", size: 16, color: SILVER }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Arial", size: 16, color: SILVER }),
        ]
      })] })
    },

    children: [

      // ── TITLE ─────────────────────────────────────────────────────────────
      titleBand(),
      sp(360),

      // ── 1. WHAT WAS BUILT ─────────────────────────────────────────────────
      sectionHeading("What Was Built"),
      introPara("A fully operational enterprise AI agent system \u2014 built from scratch \u2014 integrating an AI assistant with Microsoft 365, SharePoint, five live manufacturer APIs, and a self-growing knowledge base. Every component listed below was individually configured, coded, and deployed."),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [2800, 6560],
        rows: [
          new TableRow({ children: [hCell("Component", 2800), hCell("What It Does", 6560)] }),
          ...whatWasBuilt.map(([comp, desc], i) => new TableRow({ children: [
            dCell(comp, i % 2 === 0 ? ROW_A : ROW_B, 2800, true, KEY_TXT),
            dCell(desc, i % 2 === 0 ? ROW_A : ROW_B, 6560),
          ]}))
        ]
      }),
      sp(360),

      // ── 2. FIELD SCENARIO ENGINE ──────────────────────────────────────────
      sectionHeading("Field Scenario Engine \u2014 Equipment Coverage by Tier"),
      introPara("The Field Scenario Builder handles troubleshooting across three tiers of complexity. A field technician describes the problem in plain English; the system identifies the equipment tier and pulls from the appropriate manufacturer sources automatically."),

      subHeading("Tier 1 \u2014 Foundational  (network cabling, desktops, basic peripherals)"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [1100, 1760, 2300, 4200],
        rows: [
          new TableRow({ children: [hCell("Tier", 1100), hCell("Category", 1760), hCell("Equipment / Models", 2300), hCell("Scenario Types Supported", 4200)] }),
          ...equipment[0].rows.map(([cat, models, scenarios], i) => new TableRow({ children: [
            tierCell("Foundational", i % 2 === 0 ? TIER_FOUND : "#F1F8F1", TIER_FOUND_K, 1100),
            dCell(cat,       i % 2 === 0 ? TIER_FOUND : "#F1F8F1", 1760, true, KEY_TXT),
            dCell(models,    i % 2 === 0 ? TIER_FOUND : "#F1F8F1", 2300, false, "444444"),
            dCell(scenarios, i % 2 === 0 ? TIER_FOUND : "#F1F8F1", 4200),
          ]}))
        ]
      }),
      sp(220),

      subHeading("Tier 2 \u2014 Intermediate  (document scanners, MFPs, M365, workstations)"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [1100, 1760, 2300, 4200],
        rows: [
          new TableRow({ children: [hCell("Tier", 1100), hCell("Category", 1760), hCell("Equipment / Models", 2300), hCell("Scenario Types Supported", 4200)] }),
          ...equipment[1].rows.map(([cat, models, scenarios], i) => new TableRow({ children: [
            tierCell("Intermediate", i % 2 === 0 ? TIER_MID : "#FFFBF0", TIER_MID_K, 1100),
            dCell(cat,       i % 2 === 0 ? TIER_MID : "#FFFBF0", 1760, true, KEY_TXT),
            dCell(models,    i % 2 === 0 ? TIER_MID : "#FFFBF0", 2300, false, "444444"),
            dCell(scenarios, i % 2 === 0 ? TIER_MID : "#FFFBF0", 4200),
          ]}))
        ]
      }),
      sp(220),

      subHeading("Tier 3 \u2014 Advanced  (Cisco network infrastructure, live CVE correlation, cross-vendor)"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [1100, 1760, 2300, 4200],
        rows: [
          new TableRow({ children: [hCell("Tier", 1100), hCell("Category", 1760), hCell("Equipment / Models", 2300), hCell("Scenario Types Supported", 4200)] }),
          ...equipment[2].rows.map(([cat, models, scenarios], i) => new TableRow({ children: [
            tierCell("Advanced", i % 2 === 0 ? TIER_ADV : "#FDF0F5", TIER_ADV_K, 1100),
            dCell(cat,       i % 2 === 0 ? TIER_ADV : "#FDF0F5", 1760, true, KEY_TXT),
            dCell(models,    i % 2 === 0 ? TIER_ADV : "#FDF0F5", 2300, false, "444444"),
            dCell(scenarios, i % 2 === 0 ? TIER_ADV : "#FDF0F5", 4200),
          ]}))
        ]
      }),
      sp(360),

      // ── 3. HOW A SCENARIO IS GENERATED ───────────────────────────────────
      sectionHeading("How a Field Scenario Is Generated"),
      introPara("Each diagnostic report is assembled through a 7-step pipeline that runs entirely within the MCP server. The field technician inputs one sentence; the system executes parallel queries across all sources and returns a structured report in seconds."),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [440, 1720, 4360, 2840],
        rows: [
          new TableRow({ children: [hCell("#", 440), hCell("Step", 1720), hCell("What Happens", 4360), hCell("Data Source", 2840)] }),
          ...pipeline.map(([num, step, what, source], i) => new TableRow({ children: [
            dCell(num,    i % 2 === 0 ? PIPE_BG : ROW_B, 440,  true, PIPE_K),
            dCell(step,   i % 2 === 0 ? PIPE_BG : ROW_B, 1720, true, KEY_TXT),
            dCell(what,   i % 2 === 0 ? PIPE_BG : ROW_B, 4360),
            dCell(source, i % 2 === 0 ? PIPE_BG : ROW_B, 2840, false, "555555"),
          ]}))
        ]
      }),
      sp(360),

      // ── 4. KNOWLEDGE BASE ARCHITECTURE ───────────────────────────────────
      sectionHeading("Knowledge Base Architecture & Integration"),
      introPara("The SharePoint KB is not a static repository \u2014 it grows and updates itself continuously through three parallel channels: nightly automated refresh, passive capture from email and Teams, and direct upload from scenario outputs."),

      subHeading("Library Structure"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [1560, 5400, 2400],
        rows: [
          new TableRow({ children: [hCell("Library", 1560), hCell("Content", 5400), hCell("Refresh Cycle", 2400)] }),
          ...kbLibraries.map(([lib, content, cycle], i) => new TableRow({ children: [
            dCell(lib,     i % 2 === 0 ? KB_BG : ROW_B, 1560, true, KB_K),
            dCell(content, i % 2 === 0 ? KB_BG : ROW_B, 5400),
            dCell(cycle,   i % 2 === 0 ? KB_BG : ROW_B, 2400, false, "555555"),
          ]}))
        ]
      }),
      sp(220),

      subHeading("How the KB Grows Over Time"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [2200, 7160],
        rows: [
          new TableRow({ children: [hCell("Growth Channel", 2200), hCell("How It Works", 7160)] }),
          ...kbGrowth.map(([channel, how], i) => new TableRow({ children: [
            dCell(channel, i % 2 === 0 ? KB_BG : ROW_B, 2200, true, KB_K),
            dCell(how,     i % 2 === 0 ? KB_BG : ROW_B, 7160),
          ]}))
        ]
      }),
      sp(360),

      // ── 5. TECHNICAL BUILD COMPLEXITY ────────────────────────────────────
      sectionHeading("Technical Build Complexity \u2014 What It Took to Create This"),
      introPara("Each component below required independent research, configuration, coding, and testing. There was no template or course to follow \u2014 this was built by working through real API documentation, error messages, and live debugging."),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [2200, 2400, 4760],
        rows: [
          new TableRow({ children: [hCell("What Was Built", 2200), hCell("Technology Used", 2400), hCell("Why It Was Non-Trivial", 4760)] }),
          ...buildComplexity.map(([what, tech, why], i) => new TableRow({ children: [
            dCell(what, i % 2 === 0 ? BUILD_BG : ROW_B, 2200, true, BUILD_K),
            dCell(tech, i % 2 === 0 ? BUILD_BG : ROW_B, 2400, false, "444444"),
            dCell(why,  i % 2 === 0 ? BUILD_BG : ROW_B, 4760),
          ]}))
        ]
      }),
      sp(360),

      // ── 6. EQUIVALENT CERTIFICATIONS ─────────────────────────────────────
      sectionHeading("Equivalent Certifications"),
      introPara("The skills applied in this project directly correspond to the following industry certifications and professional development tracks:"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [3600, 1300, 4460],
        rows: [
          new TableRow({ children: [hCell("Certification", 3600), hCell("Role", 1300), hCell("Relevance to This Work", 4460)] }),
          ...certifications.map(([cert, role, rel], i) => new TableRow({ children: [
            dCell(cert, i % 2 === 0 ? ROW_A : ROW_B, 3600, true,  KEY_TXT),
            dCell(role, i % 2 === 0 ? ROW_A : ROW_B, 1300, false, "666666"),
            dCell(rel,  i % 2 === 0 ? ROW_A : ROW_B, 4460),
          ]}))
        ]
      }),
      sp(360),

      // ── 7. SKILLS DEMONSTRATED ───────────────────────────────────────────
      sectionHeading("Skills Demonstrated"),
      introPara("Each skill area was actively applied \u2014 not studied theoretically \u2014 during the design, build, and deployment of the live system:"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [2760, 6600],
        rows: [
          new TableRow({ children: [hCell("Skill Area", 2760), hCell("Applied In This Project", 6600)] }),
          ...skills.map(([skill, applied], i) => new TableRow({ children: [
            dCell(skill,   i % 2 === 0 ? ROW_A : ROW_B, 2760, true, KEY_TXT),
            dCell(applied, i % 2 === 0 ? ROW_A : ROW_B, 6600),
          ]}))
        ]
      }),
      sp(360),

      // ── 8. HOW TO DESCRIBE ───────────────────────────────────────────────
      sectionHeading("How to Describe This Experience"),
      introPara("Use the phrasing below to communicate this work clearly and confidently across different professional settings:"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [1960, 7400],
        rows: [
          new TableRow({ children: [hCell("Context", 1960), hCell("What to Say", 7400)] }),
          ...howToDescribe.map(([ctx, say], i) => new TableRow({ children: [
            dCell(ctx, i % 2 === 0 ? ROW_A : ROW_B, 1960, true, KEY_TXT),
            dCell(say, i % 2 === 0 ? ROW_A : ROW_B, 7400),
          ]}))
        ]
      }),
      sp(360),

      // ── 9. ACCESSIBILITY & DEPLOYMENT ────────────────────────────────────
      sectionHeading("Accessibility & Deployment"),
      introPara("All components run on cloud infrastructure \u2014 no local server or desktop installation is required. The system is fully accessible from any device at any location:"),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [2560, 6800],
        rows: [
          new TableRow({ children: [hCell("Access Point", 2560), hCell("Details", 6800)] }),
          ...accessibility.map(([point, detail], i) => new TableRow({ children: [
            dCell(point,  i % 2 === 0 ? ROW_A : ROW_B, 2560, true, KEY_TXT),
            dCell(detail, i % 2 === 0 ? ROW_A : ROW_B, 6800),
          ]}))
        ]
      }),
      sp(360),

      // ── NOTE BOX ─────────────────────────────────────────────────────────
      noteBox(),
      sp(200),
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('C:\\claude-it-agent\\AI-Agent-Engineering-Credentials.docx', buf);
  console.log('Done: C:\\claude-it-agent\\AI-Agent-Engineering-Credentials.docx');
}).catch(err => { console.error(err); process.exit(1); });
