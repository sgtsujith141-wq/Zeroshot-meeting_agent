#!/usr/bin/env python3
"""Export a Markdown document to an A4 PDF with the same headless-Chromium renderer as the
meeting report. Supports the subset used in docs/: headings, paragraphs, bullet lists, tables,
code blocks, inline code, bold and links.

  backend/.venv/bin/python scripts/md_to_pdf.py docs/FINAL_PRODUCT_AUDIT.md docs/FINAL_PRODUCT_AUDIT.pdf
"""

from __future__ import annotations

import re
import sys
from html import escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.services.report import render_pdf  # noqa: E402

CSS = """
@page { size: A4; margin: 20mm 17mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt sans-serif; color: #637178; } }
body { font-family: "Avenir Next", "Helvetica Neue", Arial, sans-serif; font-size: 9.4pt; line-height: 1.5; color: #19262A; }
h1 { font-family: "Iowan Old Style", Charter, Georgia, serif; font-size: 22pt; border-top: 5pt solid #172D30; padding-top: 12pt; margin: 0 0 8pt; }
h2 { font-family: "Iowan Old Style", Charter, Georgia, serif; font-size: 13pt; margin: 16pt 0 5pt; padding-bottom: 3pt; border-bottom: .75pt solid #E3E2DC; break-after: avoid; }
h3 { font-size: 10pt; margin: 10pt 0 3pt; }
table { width: 100%; border-collapse: collapse; font-size: 8.3pt; margin: 4pt 0 8pt; }
th { text-align: left; border-bottom: .75pt solid #19262A; padding: 3pt 5pt 3pt 0; color: #5A676E; }
td { border-bottom: .5pt solid #E3E2DC; padding: 4pt 5pt 4pt 0; vertical-align: top; }
tr { break-inside: avoid; }
code { font-family: Menlo, monospace; font-size: 8pt; background: #F3EFE8; padding: 0 2pt; border-radius: 2pt; }
pre { font-family: Menlo, monospace; font-size: 7.2pt; background: #F7F4EE; padding: 8pt; white-space: pre; overflow: hidden; break-inside: avoid; }
ul, ol { padding-left: 16pt; } li { margin-bottom: 3pt; } a { color: #AB452E; }
figure { margin: 6pt 0 10pt; break-inside: avoid; } figure img { width: 100%; border: .5pt solid #E3E2DC; border-radius: 3pt; }
figure.half { display: inline-block; width: 48%; margin-right: 2%; vertical-align: top; }
figcaption { font-size: 8pt; color: #5A676E; margin-top: 3pt; }
h2.page { break-before: page; }
"""


def inline(text: str) -> str:
    codes: list[str] = []

    def keep(m: re.Match) -> str:
        codes.append(f"<code>{escape(m.group(1))}</code>")
        return f"\x00{len(codes) - 1}\x00"
    out = escape(re.sub(r"`([^`]+)`", keep, text), quote=False)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])", r"<em>\1</em>", out)
    out = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', out)
    return re.sub(r"\x00(\d+)\x00", lambda m: codes[int(m.group(1))], out)


def cells(row: str) -> list[str]:
    """Table cells, split on | but not on an escaped \\|."""
    parts = re.split(r"(?<!\\)\|", row.strip().strip("|") if not row.strip().endswith("\\|") else row.strip()[1:])
    return [c.strip().replace("\\|", "|") for c in parts]


def convert(md: str, base: Path) -> str:
    lines, html, i = md.splitlines(), [], 0
    while i < len(lines):
        line = lines[i]
        if m := re.match(r"!\[([^\]]*)\]\(([^)]+)\)(\{half\})?$", line.strip()):
            src = (base / m.group(2)).resolve().as_uri()
            cls = " class='half'" if m.group(3) else ""
            html.append(f"<figure{cls}><img src='{src}' alt='{escape(m.group(1))}'><figcaption>{inline(m.group(1))}</figcaption></figure>")
            i += 1
        elif line.startswith("```"):
            j = i + 1
            while j < len(lines) and not lines[j].startswith("```"):
                j += 1
            html.append("<pre>" + escape("\n".join(lines[i + 1:j])) + "</pre>")
            i = j + 1
        elif m := re.match(r"(#{1,3}) (.*)", line):
            n, title = len(m.group(1)), m.group(2)
            page = title.endswith(" {page}")  # a heading that starts a new page
            title = title.removesuffix(" {page}")
            html.append(f"<h{n}{' class=page' if page else ''}>{inline(title)}</h{n}>")
            i += 1
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                row = cells(lines[i])
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in row):
                    rows.append(row)
                i += 1
            head, *body = rows
            html.append("<table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
                        + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body) + "</tbody></table>")
        elif re.match(r"\d+\. ", line):
            items = []
            while i < len(lines) and (re.match(r"\d+\. ", lines[i]) or (lines[i].startswith("   ") and items)):
                if re.match(r"\d+\. ", lines[i]):
                    items.append(re.sub(r"^\d+\. ", "", lines[i]))
                else:
                    items[-1] += " " + lines[i].strip()
                i += 1
            html.append("<ol>" + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ol>")
        elif re.match(r"\s*- ", line):
            items = []
            while i < len(lines) and (re.match(r"\s*- ", lines[i]) or (lines[i].startswith("  ") and items)):
                if re.match(r"\s*- ", lines[i]):
                    items.append(re.sub(r"^\s*- ", "", lines[i]))
                else:
                    items[-1] += " " + lines[i].strip()
                i += 1
            html.append("<ul>" + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ul>")
        elif line.strip():
            para = [line.strip()]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r"(#|\||```|\s*- |\d+\. |!\[)", lines[i]):
                para.append(lines[i].strip())
                i += 1
            html.append(f"<p>{inline(' '.join(para))}</p>")
        else:
            i += 1
    return f"<!doctype html><html lang='en'><head><meta charset='utf-8'><style>{CSS}</style></head><body>{''.join(html)}</body></html>"


if __name__ == "__main__":
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    pdf, ms = render_pdf(convert(src.read_text(encoding="utf-8"), src.resolve().parent))
    dst.write_bytes(pdf)
    print(f"{dst}: {len(pdf)} bytes in {ms:.0f} ms")
