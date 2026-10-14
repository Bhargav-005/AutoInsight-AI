"""Evidence-led, paginated PDF research report rendering."""

from html import escape
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def _font_name() -> str:
    font_path = Path(__import__("reportlab").__file__).parent / "fonts" / "Vera.ttf"
    if font_path.is_file():
        if "AutoInsightVera" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont("AutoInsightVera", str(font_path)))
        return "AutoInsightVera"
    return "Helvetica"


def render_research_report(data: dict) -> bytes:
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=0.72 * inch,
        leftMargin=0.72 * inch,
        topMargin=0.78 * inch,
        bottomMargin=0.7 * inch,
        title="AutoInsight AI Research Report",
        author="AutoInsight AI",
    )
    font = _font_name()
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "AutoInsightTitle",
        parent=styles["Title"],
        fontName=font,
        fontSize=23,
        leading=28,
        textColor=colors.HexColor("#14333a"),
        alignment=TA_CENTER,
        spaceAfter=14,
    )
    heading = ParagraphStyle(
        "AutoInsightHeading",
        parent=styles["Heading2"],
        fontName=font,
        fontSize=13,
        leading=17,
        textColor=colors.HexColor("#176c66"),
        spaceBefore=6,
        spaceAfter=4,
        keepWithNext=True,
    )
    body = ParagraphStyle(
        "AutoInsightBody",
        parent=styles["BodyText"],
        fontName=font,
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#273b40"),
        spaceAfter=6,
    )
    small = ParagraphStyle(
        "AutoInsightSmall",
        parent=body,
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#475b60"),
    )
    label = ParagraphStyle(
        "AutoInsightLabel", parent=small, fontName=font, textColor=colors.HexColor("#176c66")
    )

    def para(value, style=body):
        return Paragraph(escape(str(value)).replace("\n", "<br/>"), style)

    story = [
        Spacer(1, 0.05 * inch),
        Paragraph("AutoInsight AI", title),
        para("Research report", ParagraphStyle("ReportSubtitle", parent=body, alignment=TA_CENTER)),
        Spacer(1, 0.12 * inch),
        para(f"Generated {data['generated_at']}", small),
        para(f"Dataset: {data['dataset_name']} · version {data['dataset_version']}", small),
        Spacer(1, 0.1 * inch),
        Paragraph("Research question", heading),
        para(data["question"]),
        Paragraph("Executive summary", heading),
        para(
            data["interpretation"] or "The recorded evidence is summarized in the sections below."
        ),
    ]

    story.append(Paragraph("Verified findings", heading))
    findings = [
        {
            "claim": item["claim"],
            "evidence_id": "Dataset: "
            + item["dataset_evidence_id"]
            + "\nDocument: "
            + ", ".join(citation["evidence_id"] for citation in item["citations"]),
        }
        for item in data.get("comparisons", [])
    ] + data.get("findings", [])
    if findings:
        rows = [[para("Finding", label), para("Evidence reference", label)]]
        rows.extend([para(item["claim"]), para(item["evidence_id"], small)] for item in findings)
        table = Table(rows, colWidths=[4.8 * inch, 1.65 * inch], repeatRows=1, hAlign="LEFT")
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8f1ef")),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd8d6")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.append(table)
    else:
        story.append(para("No quantitative finding passed evidence verification."))

    story.append(Paragraph("Methodology", heading))
    story.append(para(data.get("methodology") or "No deterministic tool execution was recorded."))
    if data.get("tables"):
        for item in data["tables"]:
            story.append(para(item["title"], heading))
            headers = [para(str(value), label) for value in item["columns"]]
            rows = [headers]
            rows.extend([para(str(value), small) for value in row] for row in item["rows"][:20])
            table = Table(
                rows,
                colWidths=[document.width / len(headers)] * len(headers),
                repeatRows=1,
                hAlign="LEFT",
                splitInRow=1,
            )
            table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8f1ef")),
                        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd8d6")),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ]
                )
            )
            story.append(table)

    citations = data.get("document_findings", [])
    story.append(Paragraph("Reference documents and citations", heading))
    if citations:
        for finding in citations:
            if not finding.get("is_comparison"):
                story.append(para(finding["claim"]))
            for citation in finding["citations"]:
                where = (
                    f"Page {citation['page_number']}"
                    if citation.get("page_number")
                    else citation.get("location") or "Document location not paginated"
                )
                story.append(
                    para(
                        f"{citation['source_filename']} · {where} · chunk {citation['chunk_id']} "
                        f"· evidence {citation['evidence_id']}",
                        label,
                    )
                )
                story.append(para(citation["excerpt"], small))
    else:
        story.append(para("No document-derived finding with a supported citation was recorded."))

    limitations = data.get("limitations", [])
    if limitations:
        story.append(Paragraph("Limitations", heading))
        story.extend(para(f"- {item}") for item in limitations)
    story.append(Paragraph("Conclusion", heading))
    story.append(
        para(
            data["interpretation"]
            or "Use the verified findings with the recorded evidence references."
        )
    )

    def draw_page(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#cbd8d6"))
        canvas.line(0.72 * inch, 0.55 * inch, letter[0] - 0.72 * inch, 0.55 * inch)
        canvas.setFont(font, 7.5)
        canvas.setFillColor(colors.HexColor("#617276"))
        canvas.drawString(0.72 * inch, 0.38 * inch, "AutoInsight AI · Local evidence report")
        canvas.drawRightString(letter[0] - 0.72 * inch, 0.38 * inch, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    return buffer.getvalue()
