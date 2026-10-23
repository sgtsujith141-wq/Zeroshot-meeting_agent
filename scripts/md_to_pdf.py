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
ul { padding-left: 14pt; } li { margin-bottom: 3pt; } a { color: #AB452E; }
"""


def inline(text: str) -> str:
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for p in parts:
        if p.startswith("`") and p.endswith("`") and len(p) > 1:
            out.append(f"<code>{escape(p[1:-1])}</code>")
            continue
        p = escape(p, quote=False)
        p = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", p)
        p = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', p)
        out.append(p)
    return "".join(out)


def convert(md: str) -> str:
    lines, html, i = md.splitlines(), [], 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            j = i + 1
            while j < len(lines) and not lines[j].startswith("```"):
                j += 1
            html.append("<pre>" + escape("\n".join(lines[i + 1:j])) + "</pre>")
            i = j + 1
        elif m := re.match(r"(#{1,3}) (.*)", line):
            n = len(m.group(1))
            html.append(f"<h{n}>{inline(m.group(2))}</h{n}>")
            i += 1
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            head, *body = rows
            html.append("<table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
                        + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body) + "</tbody></table>")
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
            while i < len(lines) and lines[i].strip() and not re.match(r"(#|\||```|\s*- )", lines[i]):
                para.append(lines[i].strip())
                i += 1
            html.append(f"<p>{inline(' '.join(para))}</p>")
        else:
            i += 1
    return f"<!doctype html><html lang='en'><head><meta charset='utf-8'><style>{CSS}</style></head><body>{''.join(html)}</body></html>"


if __name__ == "__main__":
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    pdf, ms = render_pdf(convert(src.read_text(encoding="utf-8")))
    dst.write_bytes(pdf)
    print(f"{dst}: {len(pdf)} bytes in {ms:.0f} ms")
