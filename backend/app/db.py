"""SQLite engine, safe schema initialiser and FTS5 memory index."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from . import models  # noqa: F401  (registers tables)
from .config import get_settings

_engine: Engine | None = None

FTS_DDL = """
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    doc_type UNINDEXED, doc_id UNINDEXED, meeting_id UNINDEXED, text,
    tokenize = 'unicode61 remove_diacritics 2'
)
"""


def _make_engine(db_path: Path) -> Engine:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    eng = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})

    @event.listens_for(eng, "connect")
    def _pragmas(dbapi_conn, _):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()

    return eng


def init_db(db_path: Path | None = None) -> Engine:
    """Create missing tables only; never drops or resets existing data."""
    global _engine
    path = db_path or get_settings().db_path
    _engine = _make_engine(path)
    SQLModel.metadata.create_all(_engine)
    with _engine.begin() as conn:
        conn.execute(text(FTS_DDL))
    return _engine


def get_engine() -> Engine:
    return _engine or init_db()


def get_session() -> Iterator[Session]:
    with Session(get_engine(), expire_on_commit=False) as session:
        yield session
