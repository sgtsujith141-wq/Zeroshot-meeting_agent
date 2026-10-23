"""Copy the demo database into a disposable sandbox for browser tests.

Usage: python -I copy_db.py SOURCE_DATA_DIR SANDBOX_DATA_DIR

The source is only read (SQLite online backup, safe while the demo server runs).
Media paths are rewritten to the sandbox's own uploads folder so the sandbox
server can stream them; nothing in the source directory is modified.
"""

import shutil
import sqlite3
import sys
from pathlib import Path

src_dir, dst_dir = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
dst_dir.mkdir(parents=True, exist_ok=True)
if (src_dir / "uploads").is_dir():
    shutil.copytree(src_dir / "uploads", dst_dir / "uploads", dirs_exist_ok=True)

src = sqlite3.connect(f"file:{src_dir / 'app.db'}?mode=ro", uri=True)
dst = sqlite3.connect(dst_dir / "app.db")
src.backup(dst)
src.close()
dst.execute("UPDATE meeting SET file_path = replace(file_path, ?, ?) WHERE file_path IS NOT NULL",
            (str(src_dir / "uploads"), str(dst_dir / "uploads")))
dst.commit()
dst.close()
print(dst_dir / "app.db")
