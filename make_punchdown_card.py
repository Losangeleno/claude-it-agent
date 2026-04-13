from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT

OUTPUT = r"C:\claude-it-agent\T568_PunchDown_Reference.pdf"

doc = SimpleDocTemplate(OUTPUT, pagesize=letter,
    topMargin=0.5*inch, bottomMargin=0.5*inch,
    leftMargin=0.6*inch, rightMargin=0.6*inch)

styles = getSampleStyleSheet()

NAVY   = colors.HexColor("#1B3A6B")
WHITE  = colors.white
LGRAY  = colors.HexColor("#F2F4F7")
MGRAY  = colors.HexColor("#D0D5DD")
AMBER  = colors.HexColor("#F5A623")
GREEN  = colors.HexColor("#217A3C")

# Wire colors
W_ORG  = colors.HexColor("#FF8C00")
ORG    = colors.HexColor("#FF6600")
W_GRN  = colors.HexColor("#90C050")
BLUE   = colors.HexColor("#1565C0")
W_BLU  = colors.HexColor("#90B8E0")
GRN    = colors.HexColor("#2E7D32")
W_BRN  = colors.HexColor("#C8A070")
BROWN  = colors.HexColor("#6D4C41")

title_style = ParagraphStyle("title", fontSize=22, fontName="Helvetica-Bold",
    textColor=WHITE, alignment=TA_CENTER, spaceAfter=4)
sub_style = ParagraphStyle("sub", fontSize=11, fontName="Helvetica",
    textColor=WHITE, alignment=TA_CENTER)
head_style = ParagraphStyle("head", fontSize=13, fontName="Helvetica-Bold",
    textColor=WHITE, alignment=TA_CENTER)
label_style = ParagraphStyle("label", fontSize=10, fontName="Helvetica-Bold",
    textColor=NAVY, alignment=TA_CENTER)
note_style = ParagraphStyle("note", fontSize=9, fontName="Helvetica",
    textColor=colors.HexColor("#344054"), leading=14)
tip_style = ParagraphStyle("tip", fontSize=10, fontName="Helvetica-Bold",
    textColor=NAVY, alignment=TA_CENTER)

story = []

# ── TITLE BANNER ──────────────────────────────────────────────────────────────
title_data = [[Paragraph("Network Jack Punch Down Reference", title_style)],
              [Paragraph("T568B (Standard US) &nbsp;&nbsp;|&nbsp;&nbsp; T568A (Alt / Government)", sub_style)]]
title_tbl = Table(title_data, colWidths=[7.3*inch])
title_tbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), NAVY),
    ("TOPPADDING",    (0,0), (-1,-1), 10),
    ("BOTTOMPADDING", (0,0), (-1,-1), 10),
    ("LEFTPADDING",   (0,0), (-1,-1), 12),
    ("RIGHTPADDING",  (0,0), (-1,-1), 12),
    ("ROWBACKGROUNDS",(0,0), (-1,-1), [NAVY]),
]))
story.append(title_tbl)
story.append(Spacer(1, 10))

# ── SIDE-BY-SIDE WIRING TABLES ────────────────────────────────────────────────
def wire_row(pin, stripe_color, base_color, stripe_label, base_label, text_color=colors.black):
    pin_cell  = Paragraph(f"<b>{pin}</b>", ParagraphStyle("p", fontSize=11, fontName="Helvetica-Bold",
                    textColor=WHITE, alignment=TA_CENTER))
    color_cell = ""
    desc_cell = Paragraph(f"<b>{stripe_label} / {base_label}</b>" if stripe_label else f"<b>{base_label}</b>",
                    ParagraphStyle("d", fontSize=10, fontName="Helvetica-Bold",
                    textColor=text_color, alignment=TA_CENTER))
    return [pin_cell, color_cell, desc_cell]

def make_wire_table(title_text, rows_data):
    hdr = [[Paragraph(title_text, head_style), "", ""]]
    hdr_style = [
        ("SPAN",         (0,0), (2,0)),
        ("BACKGROUND",   (0,0), (2,0), NAVY),
        ("TOPPADDING",   (0,0), (2,0), 8),
        ("BOTTOMPADDING",(0,0), (2,0), 8),
    ]

    col_hdr = [[
        Paragraph("<b>Pin</b>", ParagraphStyle("ch", fontSize=9, fontName="Helvetica-Bold",
            textColor=WHITE, alignment=TA_CENTER)),
        Paragraph("<b>Color</b>", ParagraphStyle("ch", fontSize=9, fontName="Helvetica-Bold",
            textColor=WHITE, alignment=TA_CENTER)),
        Paragraph("<b>Wire</b>", ParagraphStyle("ch", fontSize=9, fontName="Helvetica-Bold",
            textColor=WHITE, alignment=TA_CENTER)),
    ]]
    col_hdr_style = [
        ("BACKGROUND", (0,0), (-1,-1), colors.HexColor("#2E5090")),
        ("TOPPADDING",    (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ]

    all_rows = hdr + col_hdr + [r[0] for r in rows_data]
    tbl = Table(all_rows, colWidths=[0.5*inch, 0.65*inch, 2.2*inch])

    style_cmds = hdr_style + col_hdr_style + [
        ("GRID",         (0,0), (-1,-1), 0.5, MGRAY),
        ("TOPPADDING",   (0,2), (-1,-1), 7),
        ("BOTTOMPADDING",(0,2), (-1,-1), 7),
        ("ALIGN",        (0,0), (-1,-1), "CENTER"),
        ("VALIGN",       (0,0), (-1,-1), "MIDDLE"),
    ]
    for i, row in enumerate(rows_data):
        r = i + 2  # offset for header + col header
        bg, stripe, base, txt = row[1], row[2], row[3], row[4]
        style_cmds += [
            ("BACKGROUND", (0, r), (0, r), NAVY),
            ("BACKGROUND", (1, r), (1, r), bg),
            ("BACKGROUND", (2, r), (2, r), LGRAY if i % 2 == 0 else WHITE),
            ("TEXTCOLOR",  (2, r), (2, r), txt),
        ]

    tbl.setStyle(TableStyle(style_cmds))
    return tbl

# T568B rows: [pin_cell, swatch_bg, stripe_label, base_label, text_color]
b_rows = [
    [wire_row(1,"","","White","Orange")[0], W_ORG, "White", "Orange", colors.HexColor("#7A3A00")],
    [wire_row(2,"","","","Orange")[0],      ORG,   "",      "Orange", WHITE],
    [wire_row(3,"","","White","Green")[0],  W_GRN, "White", "Green",  colors.HexColor("#1B4D1B")],
    [wire_row(4,"","","","Blue")[0],        BLUE,  "",      "Blue",   WHITE],
    [wire_row(5,"","","White","Blue")[0],   W_BLU, "White", "Blue",   colors.HexColor("#0D47A1")],
    [wire_row(6,"","","","Green")[0],       GRN,   "",      "Green",  WHITE],
    [wire_row(7,"","","White","Brown")[0],  W_BRN, "White", "Brown",  colors.HexColor("#4E342E")],
    [wire_row(8,"","","","Brown")[0],       BROWN, "",      "Brown",  WHITE],
]

a_rows = [
    [wire_row(1,"","","White","Green")[0],  W_GRN, "White", "Green",  colors.HexColor("#1B4D1B")],
    [wire_row(2,"","","","Green")[0],       GRN,   "",      "Green",  WHITE],
    [wire_row(3,"","","White","Orange")[0], W_ORG, "White", "Orange", colors.HexColor("#7A3A00")],
    [wire_row(4,"","","","Blue")[0],        BLUE,  "",      "Blue",   WHITE],
    [wire_row(5,"","","White","Blue")[0],   W_BLU, "White", "Blue",   colors.HexColor("#0D47A1")],
    [wire_row(6,"","","","Orange")[0],      ORG,   "",      "Orange", WHITE],
    [wire_row(7,"","","White","Brown")[0],  W_BRN, "White", "Brown",  colors.HexColor("#4E342E")],
    [wire_row(8,"","","","Brown")[0],       BROWN, "",      "Brown",  WHITE],
]

t568b_tbl = make_wire_table("T568B  —  Standard (USA)", b_rows)
t568a_tbl = make_wire_table("T568A  —  Alternate / Gov", a_rows)

side_by_side = Table([[t568b_tbl, Spacer(0.2*inch, 1), t568a_tbl]],
    colWidths=[3.35*inch, 0.2*inch, 3.35*inch])
side_by_side.setStyle(TableStyle([
    ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("LEFTPADDING",  (0,0), (-1,-1), 0),
    ("RIGHTPADDING", (0,0), (-1,-1), 0),
]))
story.append(side_by_side)
story.append(Spacer(1, 10))

# ── MEMORY TIP ────────────────────────────────────────────────────────────────
tip_data = [[
    Paragraph("<b>T568B Memory Tip:</b>  WO · O · WG · BL · WBL · G · WBR · BR", tip_style),
    Paragraph("<b>T568A Memory Tip:</b>  WG · G · WO · BL · WBL · O · WBR · BR", tip_style),
]]
tip_tbl = Table(tip_data, colWidths=[3.55*inch, 3.55*inch])
tip_tbl.setStyle(TableStyle([
    ("BACKGROUND",   (0,0), (0,0), colors.HexColor("#E8F0FD")),
    ("BACKGROUND",   (1,0), (1,0), colors.HexColor("#E8F5E9")),
    ("TOPPADDING",   (0,0), (-1,-1), 8),
    ("BOTTOMPADDING",(0,0), (-1,-1), 8),
    ("LEFTPADDING",  (0,0), (-1,-1), 10),
    ("RIGHTPADDING", (0,0), (-1,-1), 10),
    ("BOX",          (0,0), (0,0), 1, colors.HexColor("#2E5090")),
    ("BOX",          (1,0), (1,0), 1, colors.HexColor("#217A3C")),
]))
story.append(tip_tbl)
story.append(Spacer(1, 10))

# ── RULES & REMINDERS ─────────────────────────────────────────────────────────
rules_hdr = Table([[Paragraph("Rules &amp; Reminders", head_style)]],
    colWidths=[7.3*inch])
rules_hdr.setStyle(TableStyle([
    ("BACKGROUND",   (0,0), (-1,-1), NAVY),
    ("TOPPADDING",   (0,0), (-1,-1), 7),
    ("BOTTOMPADDING",(0,0), (-1,-1), 7),
]))
story.append(rules_hdr)

rules = [
    ["Strip outer jacket 1.5 inches — do NOT nick the wire insulation"],
    ["Untwist pairs no more than 1/2 inch — excess untwisting causes crosstalk"],
    ["Seat wire fully in slot BEFORE punching — use the punch tool blade facing outward"],
    ["A click sound confirms the wire is properly seated and terminated"],
    ["Use T568B for all standard US installs — both ends must match"],
    ["T568A is required for government / federal installations"],
    ["Crossover cable = T568A on one end + T568B on other end"],
    ["Test all 8 conductors with a cable tester after every termination"],
]
rules_rows = []
for i, r in enumerate(rules):
    bg = LGRAY if i % 2 == 0 else WHITE
    bullet = Paragraph(f"&#x2022;  {r[0]}", note_style)
    rules_rows.append([bullet])

rules_tbl = Table(rules_rows, colWidths=[7.3*inch])
rules_tbl.setStyle(TableStyle([
    ("ROWBACKGROUNDS", (0,0), (-1,-1), [LGRAY, WHITE]),
    ("TOPPADDING",     (0,0), (-1,-1), 6),
    ("BOTTOMPADDING",  (0,0), (-1,-1), 6),
    ("LEFTPADDING",    (0,0), (-1,-1), 14),
    ("RIGHTPADDING",   (0,0), (-1,-1), 14),
    ("GRID",           (0,0), (-1,-1), 0.25, MGRAY),
]))
story.append(rules_tbl)
story.append(Spacer(1, 10))

# ── CABLE TYPE QUICK REF ──────────────────────────────────────────────────────
cable_hdr = Table([[Paragraph("Cable Type Quick Reference", head_style)]],
    colWidths=[7.3*inch])
cable_hdr.setStyle(TableStyle([
    ("BACKGROUND",   (0,0), (-1,-1), NAVY),
    ("TOPPADDING",   (0,0), (-1,-1), 7),
    ("BOTTOMPADDING",(0,0), (-1,-1), 7),
]))
story.append(cable_hdr)

cable_rows = [
    [Paragraph("<b>Cable Type</b>", label_style),
     Paragraph("<b>End A</b>", label_style),
     Paragraph("<b>End B</b>", label_style),
     Paragraph("<b>Use</b>", label_style)],
    ["Straight-Through", "T568B", "T568B", "PC to Switch / Wall Jack to Patch Panel"],
    ["Crossover",        "T568A", "T568B", "Switch to Switch / PC to PC (legacy)"],
    ["Straight-Through", "T568A", "T568A", "Government / Federal installs"],
]
cable_tbl = Table(cable_rows, colWidths=[1.6*inch, 1.2*inch, 1.2*inch, 3.3*inch])
cable_tbl.setStyle(TableStyle([
    ("BACKGROUND",   (0,0), (-1,0), colors.HexColor("#2E5090")),
    ("TEXTCOLOR",    (0,0), (-1,0), WHITE),
    ("ROWBACKGROUNDS",(0,1), (-1,-1), [LGRAY, WHITE, LGRAY]),
    ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTNAME",     (0,1), (-1,-1), "Helvetica"),
    ("FONTSIZE",     (0,0), (-1,-1), 9),
    ("ALIGN",        (0,0), (-1,-1), "CENTER"),
    ("VALIGN",       (0,0), (-1,-1), "MIDDLE"),
    ("GRID",         (0,0), (-1,-1), 0.5, MGRAY),
    ("TOPPADDING",   (0,0), (-1,-1), 6),
    ("BOTTOMPADDING",(0,0), (-1,-1), 6),
]))
story.append(cable_tbl)
story.append(Spacer(1, 8))

# ── FOOTER ────────────────────────────────────────────────────────────────────
footer = Table([[Paragraph(
    "ClaudeITAgent &nbsp;|&nbsp; IT Knowledge Base &nbsp;|&nbsp; Cabling Reference Card &nbsp;|&nbsp; support.dell.com",
    ParagraphStyle("ft", fontSize=8, fontName="Helvetica", textColor=colors.HexColor("#667085"),
        alignment=TA_CENTER)
)]], colWidths=[7.3*inch])
footer.setStyle(TableStyle([
    ("TOPPADDING",    (0,0), (-1,-1), 4),
    ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ("LINEABOVE",     (0,0), (-1,0), 0.5, MGRAY),
]))
story.append(footer)

doc.build(story)
print(f"PDF created: {OUTPUT}")
