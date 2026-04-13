const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel,
        VerticalAlign, LevelFormat, Header, Footer, PageNumber } = require("docx");
const fs = require("fs");

const OUT = "C:\\claude-it-agent\\AI-Agent-Engineering-Credentials.docx";

const border = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const hdrBorder = { style: BorderStyle.SINGLE, size: 6, color: "1E3A5F" };
const hdrBorders = { top: hdrBorder, bottom: hdrBorder, left: hdrBorder, right: hdrBorder };

function hCell(text, width) {
  return new TableCell({
    borders: hdrBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: "1E3A5F", type: ShadingType.CLEAR },
    margins: { top: 120, bottom: 120, left: 160, right: 160 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ alignment: AlignmentType.LEFT,
      children: [new TextRun({ text, bold: true, color: "FFFFFF", font: "Arial", size: 22 })] })]
  });
}

function dCell(text, fill, width, bold, color) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: fill || "FFFFFF", type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 160, right: 160 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, bold: bold || false,
      color: color || "222222", font: "Arial", size: 21 })] })]
  });
}

function sp(n) {
  return new Paragraph({ spacing: { after: n || 200 }, children: [new TextRun("")] });
}

function divider() {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1E3A5F", space: 1 } },
    children: [new TextRun("")]
  });
}

const courses = [
  ["Microsoft Certified: Azure Solutions Architect Expert",
   "Core certification", "Covers Azure AD, Graph API, app registrations, OAuth2, API permissions — exactly what was used to build the agent backend.",
   "E3EEF8"],
  ["Microsoft Certified: Power Platform Functional Consultant",
   "Supporting", "Covers Power Automate flows, SharePoint integration, and the automation pipelines built for the KB.",
   "F4F6FC"],
  ["Microsoft 365 Certified: Administrator Expert",
   "Supporting", "Covers Microsoft 365 tenant administration, Exchange Online, SharePoint, and Teams — the foundation for the knowledge base infrastructure.",
   "E3EEF8"],
  ["Node.js Application Developer (Linux Foundation / OpenJS)",
   "Supporting", "Covers the server-side JavaScript (Node.js) used to build the MCP agent server, API handlers, and automation scripts.",
   "F4F6FC"],
  ["CompTIA Network+",
   "Supporting", "Covers network fundamentals including structured cabling, T568B wiring standards, and network troubleshooting — the field skills demonstrated.",
   "E3EEF8"],
];

const skills = [
  ["Azure Active Directory & App Registrations", "Registered enterprise applications, configured OAuth2 client credentials, granted API permissions with admin consent"],
  ["Microsoft Graph API", "Built authenticated API calls to Microsoft 365 services — mail, SharePoint, service health, and planned maintenance endpoints"],
  ["SharePoint Knowledge Management", "Designed and populated a multi-library IT Knowledge Base in SharePoint with automated nightly refresh from manufacturer APIs"],
  ["Power Automate", "Built automated cloud flows to capture emails and Teams messages into the knowledge base without manual intervention"],
  ["AI Agent Development (MCP)", "Developed a full Model Context Protocol (MCP) server in Node.js connecting an AI assistant to live enterprise data sources"],
  ["Cisco PSIRT API Integration", "Integrated live Cisco security advisory feeds for real-time vulnerability monitoring across network product lines"],
  ["Field Scenario Generation", "Engineered a multi-source scenario builder that cross-references manufacturer documentation to produce structured field test plans"],
  ["Structured Cabling (T568B)", "Applied industry-standard T568B wiring for network jack termination and patch panel documentation"],
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 38, bold: true, font: "Arial", color: "1E3A5F" },
        paragraph: { spacing: { before: 0, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "1E3A5F" },
        paragraph: { spacing: { before: 320, after: 140 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
      }
    },
    headers: {
      default: new Header({ children: [
        new Paragraph({
          tabStops: [{ type: "right", position: 10080 }],
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "1E3A5F", space: 4 } },
          children: [
            new TextRun({ text: "AI Agent Engineering — Professional Credentials", font: "Arial", size: 18, color: "1E3A5F", bold: true }),
            new TextRun({ text: "\t" + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" }), font: "Arial", size: 18, color: "999999" }),
          ]
        })
      ]})
    },
    footers: {
      default: new Footer({ children: [
        new Paragraph({
          tabStops: [{ type: "right", position: 10080 }],
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 4 } },
          children: [
            new TextRun({ text: "Confidential — Professional Development Record", font: "Arial", size: 17, color: "AAAAAA", italics: true }),
            new TextRun({ text: "\tPage ", font: "Arial", size: 17, color: "AAAAAA" }),
            new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 17, color: "AAAAAA" }),
          ]
        })
      ]})
    },
    children: [

      // Title block
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "AI Agent Engineering", bold: true, font: "Arial", size: 44, color: "1E3A5F" })]
      }),
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: "Professional Skills & Equivalent Certifications", font: "Arial", size: 26, color: "444444", bold: true })]
      }),
      new Paragraph({
        spacing: { after: 20 },
        children: [new TextRun({ text: "Enterprise AI integration, Microsoft 365 automation, structured cabling, and knowledge management systems", font: "Arial", size: 21, color: "777777", italics: true })]
      }),
      divider(),
      sp(240),

      // What was built
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "What Was Built", font: "Arial", size: 26, bold: true, color: "1E3A5F" })] }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: "A fully functional enterprise AI agent system was designed, built, and deployed — integrating an AI assistant with Microsoft 365, SharePoint, live manufacturer APIs, and field scenario generation. The system operates autonomously with nightly automated updates from Cisco, Microsoft, Dell, HP, and Fujitsu data sources.", font: "Arial", size: 21, color: "333333" })]
      }),

      new Table({
        width: { size: 10080, type: WidthType.DXA },
        columnWidths: [3200, 6880],
        rows: [
          new TableRow({ children: [hCell("Component", 3200), hCell("Description", 6880)] }),
          ...[
            ["MCP Agent Server", "Custom Node.js server using Model Context Protocol — connects AI to live enterprise tools"],
            ["SharePoint IT Knowledge Base", "Six-library SharePoint site with automated nightly refresh from manufacturer APIs"],
            ["Microsoft Graph API Integration", "OAuth2 app registration with permissions for mail, SharePoint, and M365 service health"],
            ["Cisco PSIRT Integration", "Live security advisory feed monitoring 5 Cisco product lines for vulnerabilities"],
            ["Field Scenario Builder", "Multi-source tool that cross-references Dell, HP, Fujitsu, Cisco, and Microsoft docs in real time"],
            ["Power Automate Flows", "Email-to-KB and Teams-to-KB automation flows for passive knowledge capture"],
            ["HP & Fujitsu Support Integration", "Manufacturer support content pulled nightly from HP and Fujitsu support portals"],
            ["T568B Cabling Standards", "Documented and delivered structured cabling reference for field technicians"],
            ["Web-Based Access (Desktop & Mobile)", "All components are cloud-hosted — SharePoint KB, agent tools, and Power Automate flows are accessible via web browser on any device, including smartphones and tablets"],
          ].map(([comp, desc], i) => new TableRow({ children: [
            dCell(comp, i % 2 === 0 ? "E8EEF8" : "F4F6FC", 3200, true, "1E3A5F"),
            dCell(desc, i % 2 === 0 ? "F8F9FD" : "FFFFFF", 6880, false, "333333"),
          ]}))
        ]
      }),

      sp(300),

      // Equivalent certifications
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Equivalent Certifications", font: "Arial", size: 26, bold: true, color: "1E3A5F" })] }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: "The skills applied in this project directly correspond to the following industry certifications:", font: "Arial", size: 21, color: "333333" })]
      }),

      new Table({
        width: { size: 10080, type: WidthType.DXA },
        columnWidths: [4200, 1560, 4320],
        rows: [
          new TableRow({ children: [hCell("Certification", 4200), hCell("Role", 1560), hCell("Relevance to This Work", 4320)] }),
          ...courses.map(([cert, role, relevance, fill]) => new TableRow({ children: [
            dCell(cert, fill, 4200, true, "1E3A5F"),
            dCell(role, fill, 1560, false, "555555"),
            dCell(relevance, fill, 4320, false, "333333"),
          ]}))
        ]
      }),

      sp(300),

      // Skills demonstrated
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Skills Demonstrated", font: "Arial", size: 26, bold: true, color: "1E3A5F" })] }),

      new Table({
        width: { size: 10080, type: WidthType.DXA },
        columnWidths: [3000, 7080],
        rows: [
          new TableRow({ children: [hCell("Skill Area", 3000), hCell("Applied In This Project", 7080)] }),
          ...skills.map(([skill, detail], i) => new TableRow({ children: [
            dCell(skill, i % 2 === 0 ? "E8EEF8" : "F4F6FC", 3000, true, "1E3A5F"),
            dCell(detail, i % 2 === 0 ? "F8F9FD" : "FFFFFF", 7080, false, "333333"),
          ]}))
        ]
      }),

      sp(300),

      // How to describe it
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "How to Describe This Experience", font: "Arial", size: 26, bold: true, color: "1E3A5F" })] }),

      new Table({
        width: { size: 10080, type: WidthType.DXA },
        columnWidths: [2400, 7680],
        rows: [
          new TableRow({ children: [hCell("Context", 2400), hCell("What to Say", 7680)] }),
          ...[
            ["Resume / LinkedIn", "Designed and deployed an enterprise AI agent system integrating Microsoft 365, SharePoint, and manufacturer APIs using Node.js and Model Context Protocol (MCP)"],
            ["Job interview", "I completed hands-on training in enterprise AI agent development — building MCP-based agents integrated with Microsoft 365, SharePoint, and third-party vendor APIs including Cisco PSIRT, Dell, HP, and Fujitsu"],
            ["Casual conversation", "I took an AI engineering course focused on building enterprise automation agents that connect AI to real business tools like Microsoft 365 and SharePoint"],
            ["Technical audience", "Built a full MCP server in Node.js with OAuth2 Graph API integration, multi-source KB automation, and a field scenario generation tool drawing from live manufacturer security feeds"],
          ].map(([ctx, say], i) => new TableRow({ children: [
            dCell(ctx, i % 2 === 0 ? "E8EEF8" : "F4F6FC", 2400, true, "1E3A5F"),
            dCell(say, i % 2 === 0 ? "F8F9FD" : "FFFFFF", 7680, false, "333333"),
          ]}))
        ]
      }),

      sp(300),

      // Accessibility section
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Accessibility & Deployment", font: "Arial", size: 26, bold: true, color: "1E3A5F" })] }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: "This system was built entirely on cloud infrastructure — it requires no local server or desktop installation to operate.", font: "Arial", size: 21, color: "333333" })]
      }),

      new Table({
        width: { size: 10080, type: WidthType.DXA },
        columnWidths: [2800, 7280],
        rows: [
          new TableRow({ children: [hCell("Access Point", 2800), hCell("Details", 7280)] }),
          ...[
            ["SharePoint Knowledge Base", "Fully web-based — accessible at sharepoint.com on any browser, desktop or mobile"],
            ["IT Agent (MCP Tools)", "Cloud-connected service — usable from any device with internet access via the Cowork interface"],
            ["Power Automate Flows", "Cloud-hosted automation — runs independently 24/7 with no desktop required; manageable at make.powerautomate.com"],
            ["Nightly KB Refresh", "Scheduled task pulls live data from Cisco, Microsoft, Dell, HP, and Fujitsu every night automatically"],
            ["Mobile Device Support", "SharePoint, Power Automate, and the agent interface all have fully functional mobile web and app experiences"],
          ].map(([point, detail], i) => new TableRow({ children: [
            dCell(point, i % 2 === 0 ? "E8EEF8" : "F4F6FC", 2800, true, "1E3A5F"),
            dCell(detail, i % 2 === 0 ? "F8F9FD" : "FFFFFF", 7280, false, "333333"),
          ]}))
        ]
      }),

      sp(300),

      // Closing note
      new Table({
        width: { size: 10080, type: WidthType.DXA },
        columnWidths: [10080],
        rows: [new TableRow({ children: [new TableCell({
          borders,
          width: { size: 10080, type: WidthType.DXA },
          shading: { fill: "FFF8E1", type: ShadingType.CLEAR },
          margins: { top: 160, bottom: 160, left: 240, right: 240 },
          children: [
            new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "Note on Field Relevance", bold: true, font: "Arial", size: 22, color: "1E3A5F" })] }),
            new Paragraph({ children: [new TextRun({ text: "Most formal courses do not yet cover enterprise AI agent engineering at this level. The skills applied here — MCP server development, live API orchestration, and multi-source knowledge automation — represent an emerging discipline. This project places the practitioner ahead of current curriculum in most certification programs.", font: "Arial", size: 21, color: "555555", italics: true })] }),
          ]
        })]})],
      }),

      // Footer spacing
      sp(200),
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 1 } },
        spacing: { before: 200 },
        children: [new TextRun({ text: "Generated by IT Knowledge Agent  |  " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), font: "Arial", size: 18, color: "AAAAAA", italics: true })]
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log("Created: " + OUT);
}).catch(e => { console.error("Error: " + e.message); process.exit(1); });
