"""Small deterministic title normaliser used for cross-meeting candidate matching.

Matching is advisory: a similar title only ever produces a *question* or a
reviewable patch, never a silent update.
"""

from __future__ import annotations

import re

STOPWORDS = {
    "the", "a", "an", "to", "of", "for", "and", "on", "with", "our", "this", "that",
    "task", "item", "work", "existing", "it", "in", "by", "at", "is", "be", "up",
    # generic verbs carry little identity
    "complete", "finish", "do", "handle", "take", "make", "start", "own", "write",
    "prepare", "implement", "help", "look", "into", "new", "old", "current",
}

SYNONYMS = {
    "docs": "doc", "documentation": "doc", "document": "doc", "documents": "doc",
    "qa": "test", "testing": "test", "tests": "test", "tested": "test", "verification": "test",
    "auth": "authentication", "signin": "login", "sign-in": "login", "log-in": "login",
    "implementation": "implement", "migration": "migrate", "migrating": "migrate",
    "deployment": "deploy", "review": "review", "reviews": "review",
    "apis": "api", "notes": "note", "fixing": "fix", "fixes": "fix",
}


def _stem(tok: str) -> str:
    tok = SYNONYMS.get(tok, tok)
    for suffix in ("ing", "ed", "es", "s"):
        if len(tok) > 4 and tok.endswith(suffix):
            tok = tok[: -len(suffix)]
            break
    return SYNONYMS.get(tok, tok)


def content_tokens(title: str | None) -> set[str]:
    if not title:
        return set()
    raw = re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)?", title.lower())
    out = set()
    for tok in raw:
        tok = SYNONYMS.get(tok, tok)
        if tok in STOPWORDS:
            continue
        stemmed = _stem(tok)
        if stemmed not in STOPWORDS:
            out.add(stemmed)
    return out


def title_similarity(a: str | None, b: str | None) -> float:
    ta, tb = content_tokens(a), content_tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))
