// T568B Color-Coded Wiring Reference Card — Word Document Generator
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel,
        VerticalAlign } = require("docx");
const fs = require("fs");

const OUT = "C:\\claude-it-agent\\T568B-Jack-Wiring-Reference.docx";

// Wire colors: [pin, colorName, hex fill, text color, description]
const WIRES = [
  [1, "White / Orange", "FFD580", "000000", "Pair 2 — TX+  (Data transmit +)"],
  [2, "Orange",         "FF8C00", "FFFFFF", "Pair 2 — TX-  (Data transmit -)"],
  [3, "White / Green",  "B6F0B6", "000000", "Pair 3 — RX+  (Data receive +)"],
  [4, "Blue",           "1E56A0", "FFFFFF", "Pair 1 — PoE / Unused in 100Mbps"],
  [5, "White / Blue",   "A8C8F0", "000000", "Pair 1 — PoE / Unused in 100Mbps"],
  [6, "Green",          "228B22", "FFFFFF", "Pair 3 — RX-  (Data receive -)"],
  [7, "White / Brown",  "E8D5B0", "000000", "Pair 4 — Unused in 100/1000Mbps"],
  [8, "Brown",          "8B4513", "FFFFFF", "Pair 4 — Unused in 100/1000Mbps"],
];

const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };
const headerBorder = { style: BorderStyle.SINGLE, size: 6, color: "1E3A5F" };
const headerBorders = { top: headerBorder, bottom: headerBorder, left: headerBorder, right: headerBorder };

function cell(text, fill, textColor, bold, width, center) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 150, right: 150 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text, bold: bold || false, color: textColor || "000000", font: "Arial", size: 22 })]
    })]
  });
}

function headerCell(text, width) {
  return new TableCell({
    borders: headerBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: "1E3A5F", type: ShadingType.CLEAR },
    margins: { top: 120, bottom: 120, left: 150, right: 150 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, color: "FFFFFF", font: "Arial", size: 22 })]
    })]
  });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "1E3A5F" },
        paragraph: { spacing: { before: 0, after: 200 } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "1E3A5F" },
        paragraph: { spacing: { before: 240, after: 120 } } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
      }
    },
    children: [

      // Title
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "T568B Network Jack Wiring Reference", bold: true, font: "Arial", size: 40, color: "1E3A5F" })]
      }),
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: "Standard for all new US installations  |  Use this layout for both wall jacks and patch panels", font: "Arial", size: 20, color: "555555", italics: true })]
      }),
      new Paragraph({
        spacing: { after: 300 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1E3A5F", space: 1 } },
        children: [new TextRun("")]
      }),

      // Main wiring table
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Pin Layout — Left to Right (clip facing away from you)", font: "Arial", size: 26, bold: true, color: "1E3A5F" })] }),

      new Table({
        width: { size: 10080, type: WidthType.DXA },
        columnWidths: [800, 2200, 3480, 3600],
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              headerCell("Pin", 800),
              headerCell("Wire Color", 2200),
              headerCell("Color Swatch", 3480),
              headerCell("Function", 3600),
            ]
          }),
          ...WIRES.map(([pin, name, fill, textColor, func]) =>
            new TableRow({
              children: [
                cell(String(pin), "F5F5F5", "000000", true, 800, true),
                cell(name, "FAFAFA", "000000", false, 2200, false),
                cell("  " + name + "  ", fill, textColor, true, 3480, true),
                cell(func, "FAFAFA", "555555", false, 3600, false),
              ]
            })
          )
        ]
      }),

      // Spacing
      new Paragraph({ spacing: { after: 300 }, children: [new TextRun("")] }),

      // Memory aid box
      new Table({
        width: { size: 10080, type: WidthType.DXA },
        columnWidths: [10080],
        rows: [new TableRow({ children: [new TableCell({
          borders,
          width: { size: 10080, type: WidthType.DXA },
          shading: { fill: "FFF8E1", type: ShadingType.CLEAR },
          margins: { top: 160, bottom: 160, left: 240, right: 240 },
          children: [
            new Paragraph({ children: [new TextRun({ text: "Memory Aid:  WO · O · WG · BL · WBL · G · WBR · BR", bold: true, font: "Courier New", size: 26, color: "1E3A5F" })] }),
            new Paragraph({ children: [new TextRun({ text: "White-Orange, Orange, White-Green, Blue, White-Blue, Green, White-Brown, Brown", font: "Arial", size: 20, color: "555555", italics: true })] }),
          ]
        })]})],
      }),

      new Paragraph({ spacing: { after: 300 }, children: [new TextRun("")] }),

      // Termination steps
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Termination Steps", font: "Arial", size: 26, bold: true, color: "1E3A5F" })] }),

      new Table({
        width: { size: 10080, type: WidthType.DXA },
        columnWidths: [640, 9440],
        rows: [
          ["1", "Strip outer jacket 1.5 inches — do NOT nick the inner wire insulation"],
          ["2", "Untwist pairs — maximum ½ inch only (more causes crosstalk and test failure)"],
          ["3", "Seat wires into jack slots following the T568B pin order above"],
          ["4", "Punch down firmly with 110 tool — blade facing OUTWARD (away from wire you keep)"],
          ["5", "Trim excess wire flush with the jack body"],
          ["6", "Snap jack into keystone mount and test all 8 conductors with a cable tester"],
        ].map(([num, step]) => new TableRow({ children: [
          new TableCell({
            borders,
            width: { size: 640, type: WidthType.DXA },
            shading: { fill: "1E3A5F", type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: num, bold: true, color: "FFFFFF", font: "Arial", size: 22 })] })]
          }),
          new TableCell({
            borders,
            width: { size: 9440, type: WidthType.DXA },
            shading: { fill: "FAFAFA", type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 200, right: 150 },
            children: [new Paragraph({ children: [new TextRun({ text: step, font: "Arial", size: 22 })] })]
          }),
        ]})),
      }),

      new Paragraph({ spacing: { after: 300 }, children: [new TextRun("")] }),

      // Critical rules
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Critical Rules", font: "Arial", size: 26, bold: true, color: "1E3A5F" })] }),

      new Table({
        width: { size: 10080, type: WidthType.DXA },
        columnWidths: [3360, 6720],
        rows: [
          ["Both ends must match",       "Straight-through cable = T568B on both ends"],
          ["Crossover cable",            "T568A one end + T568B other end (rarely needed today)"],
          ["Never mix standards",        "Do not mix T568A and T568B on the same cable run"],
          ["Max untwist = ½ inch",       "Untwisting more degrades signal and causes crosstalk"],
          ["Punch blade faces outward",  "Blade cuts excess wire — pointed end away from keeper wire"],
          ["Test before buttoning up",   "Test all 8 conductors before installing wall plate"],
        ].map(([rule, detail], i) => new TableRow({ children: [
          new TableCell({
            borders,
            width: { size: 3360, type: WidthType.DXA },
            shading: { fill: i % 2 === 0 ? "E8EEF8" : "F4F6FC", type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            children: [new Paragraph({ children: [new TextRun({ text: rule, bold: true, font: "Arial", size: 22, color: "1E3A5F" })] })]
          }),
          new TableCell({
            borders,
            width: { size: 6720, type: WidthType.DXA },
            shading: { fill: i % 2 === 0 ? "F8F9FD" : "FFFFFF", type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            children: [new Paragraph({ children: [new TextRun({ text: detail, font: "Arial", size: 22 })] })]
          }),
        ]})),
      }),

      // Footer note
      new Paragraph({ spacing: { before: 400 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 1 } },
        children: [new TextRun({ text: "IT Knowledge Agent  |  T568B Reference  |  " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), font: "Arial", size: 18, color: "999999", italics: true })]
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUT, buffer);
  console.log("Created: " + OUT);
}).catch(e => { console.error("Error: " + e.message); process.exit(1); });
