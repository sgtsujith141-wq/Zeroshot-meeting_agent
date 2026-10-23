"""Meeting report: built from stored records only, with the approval state stated honestly.

HTML checks run everywhere. The PDF checks render with headless Chromium and read the text back
with pdftotext; they are skipped where either is missing (e.g. CI)."""

from __future__ import annotations

import shutil
import subprocess

import pytest

from app.services import report
from test_api_flow import approve, change_set, first_meeting, make_meeting, upload_transcript

CAN_RENDER = report.find_chrome() is not None and shutil.which("pdftotext") and shutil.which("pdfinfo")


def html(client, mid: int) -> str:
    r = client.get(f"/api/meetings/{mid}/report.html")
    assert r.status_code == 200, r.text
    return r.text


def test_a_pending_meeting_is_marked_draft_and_nothing_is_called_approved(client, llm):
    mid = first_meeting(client, llm)
    h = html(client, mid)
    assert "DRAFT: PENDING APPROVAL" in h and "Not approved." in h
    assert "Complete authentication API" in h and "Proposed, not approved" in h
    assert "(approved)" not in h and ">APPROVED<" not in h
    assert "Executive summary" in h and "Transcript appendix" in h


def test_an_approved_meeting_lists_board_tasks_and_cross_meeting_changes(client, llm):
    first_meeting(client, llm)
    approve(client, change_set(client, 1))
    code = next(t["code"] for t in client.get("/api/tasks").json() if t["title"] == "Complete authentication API")
    mid2 = make_meeting(client, "Sprint sync 2", "2026-10-21T10:00:00+05:30")
    llm.push("interpret_events", {"events": [
        {"type": "REASSIGN", "task_key": code, "owner": "Priya", "strength": "firm", "segment_ids": ["s1"]},
        {"type": "CHANGE_DEADLINE", "task_key": code, "deadline_text": "Monday, October 26", "segment_ids": ["s1"]}]})
    upload_transcript(client, mid2, [("Lead", f"For the authentication API ({code}), Priya takes over; new date Monday, October 26.")])
    h = html(client, mid2)
    assert "Changes to previous commitments" in h and "No: pending approval" in h  # proposed, not yet applied
    assert approve(client, change_set(client, mid2)).status_code == 200
    h = html(client, mid2)
    assert ">APPROVED<" in h and "To do (approved)" in h
    row = h[h.index("Changes to previous commitments"):]
    assert "<td>Owner</td><td>Rahul</td><td>Priya</td>" in row and "<td>Due date</td>" in row and ">Yes<" in row


def test_transcript_only_report_when_the_analysis_has_not_run(client, llm):
    mid = make_meeting(client)
    upload_transcript(client, mid, [("Asha", "नमस्ते, कल तक API पूरा कर देना।"), ("Rahul", "ಸರಿ, ನಾಳೆ ಒಳಗೆ ಮಾಡುತ್ತೇನೆ.")], process=False)
    h = html(client, mid)
    assert "TRANSCRIPT ONLY" in h and "Transcription only." in h and "has not been run yet" in h
    assert "Executive summary" not in h and "Action register" not in h
    assert "नमस्ते, कल तक API पूरा कर देना।" in h and "ಸರಿ, ನಾಳೆ ಒಳಗೆ ಮಾಡುತ್ತೇನೆ." in h  # non-Latin text kept as stored


def test_no_transcript_means_no_report(client):
    mid = make_meeting(client)
    r = client.get(f"/api/meetings/{mid}/report.pdf")
    assert r.status_code == 409 and "no transcript" in r.json()["detail"]
    assert client.get("/api/meetings/999/report.html").status_code == 404


def test_report_text_is_escaped(client, llm):
    mid = make_meeting(client, title='Review <script>alert(1)</script> "x"')
    upload_transcript(client, mid, [("Asha", "Keep costs < 5 lakh & ship.")], process=False)  # <tags> are stripped on import
    h = html(client, mid)
    assert "<script>alert" not in h
    assert "&lt;script&gt;" in h
    assert "Keep costs &lt; 5 lakh &amp; ship." in h


def test_report_requires_the_organiser(client, llm):
    mid = first_meeting(client, llm)
    assert client.get(f"/api/meetings/{mid}/report.pdf", headers={"Authorization": ""}).status_code == 401


@pytest.mark.skipif(not CAN_RENDER, reason="headless Chromium or poppler (pdftotext) not available")
def test_pdf_renders_with_the_stored_facts_and_unicode(client, llm, tmp_path):
    mid = first_meeting(client, llm)
    client.put(f"/api/meetings/{mid}/participants/Lead", json={"display_name": "Asha", "confirmed_identity": True})
    m2 = make_meeting(client, "Code-mixed check")
    upload_transcript(client, m2, [("Asha", "नमस्ते, कल तक API पूरा कर देना।"), ("Rahul", "ಸರಿ, ನಾಳೆ ಒಳಗೆ ಮಾಡುತ್ತೇನೆ.")], process=False)
    for meeting, must in ((mid, ["Sprint sync", "Complete authentication API", "Rahul", "DRAFT: PENDING APPROVAL", "Page 1 of"]),
                          (m2, ["Code-mixed check", "TRANSCRIPT ONLY", "नमस्ते", "ಸರಿ"])):
        r = client.get(f"/api/meetings/{meeting}/report.pdf?download=1")
        assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
        assert r.headers["content-disposition"].startswith("attachment;") and int(r.headers["x-render-ms"]) >= 0
        pdf = tmp_path / f"m{meeting}.pdf"
        pdf.write_bytes(r.content)
        raw = subprocess.run(["pdftotext", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
        text = " ".join(raw.split())  # table cells wrap across lines
        for s in must:
            assert s in text, (meeting, s)
        info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True).stdout
        assert "A4" in info
