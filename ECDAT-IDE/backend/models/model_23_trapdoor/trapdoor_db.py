"""Model 23: Trapdoor IOC Database — SQLite + hash/pattern lookup (spec §23.8).

API:
    check_trapdoor(finding: dict) -> TrapdoorStatus
    get_iocs(fingerprint: str) -> list[IOC]
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from pathlib import Path

DATA_JSON = Path(__file__).resolve().parent / "data" / "trapdoor_iocs.json"
DEFAULT_DB = Path(__file__).resolve().parent / "trapdoor.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS iocs (
    ioc_id TEXT PRIMARY KEY, ioc_type TEXT, title TEXT, fingerprint TEXT,
    patterns TEXT, severity TEXT, cwe_id TEXT, recommendation TEXT, source TEXT
);
CREATE INDEX IF NOT EXISTS idx_fp ON iocs(fingerprint);
"""


def build_db(db_path: str | Path = DEFAULT_DB,
             data_path: str | Path = DATA_JSON) -> int:
    db_path = Path(db_path)
    with open(data_path, encoding="utf-8") as f:
        iocs = json.load(f)["iocs"]
    con = sqlite3.connect(db_path)
    con.executescript(SCHEMA)
    for i in iocs:
        con.execute(
            "INSERT OR REPLACE INTO iocs VALUES (?,?,?,?,?,?,?,?,?)",
            (i["ioc_id"], i["ioc_type"], i["title"], i["fingerprint"],
             json.dumps(i["patterns"]), i["severity"], i.get("cwe_id"),
             i.get("recommendation"), i.get("source")))
    con.commit()
    n = con.execute("SELECT COUNT(*) FROM iocs").fetchone()[0]
    con.close()
    return n


def _connect(db_path: str | Path) -> sqlite3.Connection:
    db_path = Path(db_path)
    if not db_path.exists():
        build_db(db_path)
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    return con


def get_iocs(fingerprint: str, db_path: str | Path = DEFAULT_DB) -> list[dict]:
    con = _connect(db_path)
    try:
        rows = con.execute("SELECT * FROM iocs WHERE fingerprint = ?",
                           (fingerprint,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def check_trapdoor(finding: dict, db_path: str | Path = DEFAULT_DB) -> dict:
    """Match a finding (code_snippet/algorithm/fingerprint) against known IOCs."""
    text = " ".join(str(finding.get(k, "")) for k in
                    ("code_snippet", "algorithm", "fingerprint", "title"))
    digest = hashlib.sha256(text.encode()).hexdigest()[:16]
    con = _connect(db_path)
    try:
        hits = []
        for r in con.execute("SELECT * FROM iocs").fetchall():
            for pat in json.loads(r["patterns"]):
                if pat.lower() in text.lower() or re.search(pat, text):
                    hits.append(dict(r))
                    break
        return {"match": bool(hits), "hits": hits, "digest": digest,
                "checked": con.execute("SELECT COUNT(*) FROM iocs").fetchone()[0]}
    finally:
        con.close()


if __name__ == "__main__":
    print("IOCs loaded:", build_db())
    print(check_trapdoor({"code_snippet": "ctx = Dual_EC_DRBG(seed)"}))
