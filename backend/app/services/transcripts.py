"""Transcript import parsers. Output: ordered segments with stable keys s1..sN.

Supported: generic JSON ({"segments": [...]}), Sarvam batch STT output JSON
(diarized_transcript.entries), WebVTT / SRT (optional "<v Name>" or "Name:"),
plain text lines "Speaker: text" with optional [hh:mm:ss] prefix.
"""

from __future__ import annotations

import json
import re

MAX_SEGMENTS = 5000
MAX_SEGMENT_CHARS = 4000


class TranscriptError(ValueError):
    pass


def _clean_text(s: str) -> str:
    s = re.sub(r"<[^>]{0,200}>", "", s)  # strip markup tags (e.g. VTT styling)
    s = "".join(ch for ch in s if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    return re.sub(r"\s+", " ", s).strip()[:MAX_SEGMENT_CHARS]


def _ts(value: str) -> float:
    parts = value.replace(",", ".").split(":")
    secs = 0.0
    for p in parts:
        secs = secs * 60 + float(p)
    return secs


def _finish(rows: list[dict], source: str) -> list[dict]:
    out = []
    for r in rows:
        text = _clean_text(str(r.get("text") or ""))
        if not text:
            continue
        speaker = _clean_text(str(r.get("speaker") or "SPEAKER_00"))[:80] or "SPEAKER_00"
        start = float(r.get("start") or 0.0)
        end = r.get("end")
        out.append({"seg_key": f"s{len(out) + 1}", "speaker_label": speaker, "start_seconds": max(0.0, start),
                    "end_seconds": float(end) if end is not None else None, "text": text,
                    "source_type": source, "original_id": r.get("id")})
    if not out:
        raise TranscriptError("no transcript segments found")
    if len(out) > MAX_SEGMENTS:
        raise TranscriptError(f"too many segments ({len(out)} > {MAX_SEGMENTS})")
    return out


def parse_sarvam_output(data: dict) -> list[dict]:
    entries = (data.get("diarized_transcript") or {}).get("entries") or []
    if entries:
        rows = [{"speaker": f"SPEAKER_{str(e.get('speaker_id', '0')).zfill(2)}",
                 "start": e.get("start_time_seconds"), "end": e.get("end_time_seconds"),
                 "text": e.get("transcript")} for e in entries]
        return _finish(rows, "stt:sarvam")
    ts = data.get("timestamps") or {}
    chunks = ts.get("chunks") or []
    if chunks:
        rows = [{"speaker": "SPEAKER_00", "start": st, "end": en, "text": ch}
                for ch, st, en in zip(chunks, ts.get("start_time_seconds") or [], ts.get("end_time_seconds") or [])]
        return _finish(rows, "stt:sarvam")
    if data.get("transcript"):
        return _finish([{"speaker": "SPEAKER_00", "start": 0, "text": data["transcript"]}], "stt:sarvam")
    raise TranscriptError("Sarvam output contains no transcript")


def parse_json(raw: str) -> list[dict]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise TranscriptError(f"invalid JSON: {exc.msg}") from exc
    if isinstance(data, dict) and ("diarized_transcript" in data or "timestamps" in data):
        return [dict(r, source_type="import:sarvam_json") for r in parse_sarvam_output(data)]
    segs = data.get("segments") if isinstance(data, dict) else data
    if not isinstance(segs, list):
        raise TranscriptError("JSON must be a list of segments or an object with 'segments'")
    rows = []
    for s in segs:
        if not isinstance(s, dict):
            raise TranscriptError("each segment must be an object")
        rows.append({"id": s.get("id"), "speaker": s.get("speaker") or s.get("speaker_label"),
                     "start": s.get("start_seconds", s.get("start", 0)),
                     "end": s.get("end_seconds", s.get("end")), "text": s.get("text")})
    return _finish(rows, "import:json")


RE_CUE_TIME = re.compile(r"(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*((\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})")
RE_VOICE = re.compile(r"^<v(?:\.[^ >]*)?\s+([^>]+)>(.*)$")
RE_SPEAKER = re.compile(r"^\s*(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?([^:\[\]]{1,60}):\s+(.+)$")


def parse_vtt_srt(raw: str) -> list[dict]:
    rows, cur = [], None
    for line in raw.splitlines():
        line = line.strip("﻿").rstrip()
        m = RE_CUE_TIME.search(line)
        if m:
            start_s = line.split("-->")[0].strip()
            cur = {"start": _ts(start_s), "end": _ts(m.group(2)), "lines": []}
            rows.append(cur)
            continue
        if cur is not None and line.strip():
            cur["lines"].append(line.strip())
        elif not line.strip():
            cur = None
    out = []
    for r in rows:
        text = " ".join(r["lines"])
        speaker = "SPEAKER_00"
        v = RE_VOICE.match(text)
        if v:
            speaker, text = v.group(1).strip(), v.group(2)
        else:
            sm = RE_SPEAKER.match(text)
            if sm:
                speaker, text = sm.group(2).strip(), sm.group(3)
        out.append({"speaker": speaker, "start": r["start"], "end": r["end"], "text": text})
    return _finish(out, "import:vtt")


def parse_text(raw: str) -> list[dict]:
    rows, t = [], 0.0
    for line in raw.splitlines():
        if not line.strip():
            continue
        m = RE_SPEAKER.match(line)
        if m:
            start = _ts(m.group(1)) if m.group(1) else t
            rows.append({"speaker": m.group(2).strip(), "start": start, "text": m.group(3)})
        elif rows:
            rows[-1]["text"] += " " + line.strip()
            continue
        else:
            rows.append({"speaker": "SPEAKER_00", "start": t, "text": line})
        t = rows[-1]["start"] + 10.0  # synthetic offsets only when none are given; flagged in source_type
    return _finish(rows, "import:text")


def parse_transcript(filename: str, raw: str) -> list[dict]:
    name = filename.lower()
    if name.endswith(".json"):
        return parse_json(raw)
    if name.endswith((".vtt", ".srt")):
        return parse_vtt_srt(raw)
    if name.endswith(".txt"):
        return parse_text(raw)
    raise TranscriptError("unsupported transcript format (use .json, .txt, .vtt or .srt)")
