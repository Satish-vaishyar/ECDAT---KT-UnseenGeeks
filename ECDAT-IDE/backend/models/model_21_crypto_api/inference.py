"""Model 21: Crypto API KB — standalone inference over the shipped SQLite DB.

Uses only the stdlib (sqlite3); no `ecdat.*` imports, so it runs inside the
class-c-stateful image. DB: data/knowledge/crypto_api_kb.sqlite
(tables: apis, algorithms, aliases, replacements, deprecations).

API (mirrors spec §21.8):
    classify_api(api_name, language) -> APIClassification dict
    get_quantum_resistance(api_name) -> QuantumStatus dict
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parent / "data" / "knowledge" / "crypto_api_kb.sqlite"


class CryptoAPIKB:
    def __init__(self, db_path: str | Path | None = None):
        self.db_path = Path(db_path) if db_path else DB
        if not self.db_path.exists():
            raise FileNotFoundError(f"Model 21 DB missing: {self.db_path}")

    def _con(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.db_path)
        con.row_factory = sqlite3.Row
        return con

    def classify_api(self, api_name: str, language: str = "python") -> dict:
        q = f"%{api_name}%"
        con = self._con()
        try:
            row = con.execute(
                "SELECT * FROM apis WHERE (api_name LIKE ? OR signature LIKE ?) "
                "AND language = ? LIMIT 1", (q, q, language)).fetchone()
            if row is None:
                row = con.execute(
                    "SELECT * FROM apis WHERE api_name LIKE ? OR signature LIKE ? "
                    "LIMIT 1", (q, q)).fetchone()
            if row is None:
                return {"api_name": api_name, "language": language,
                        "found": False, "quantum_risk": "UNKNOWN"}
            d = dict(row)
            repl = con.execute(
                "SELECT r.*, a.api_name AS new_api FROM replacements r "
                "LEFT JOIN apis a ON a.api_id = r.new_api_id "
                "WHERE r.old_api_id = ? LIMIT 1", (d["api_id"],)).fetchone()
            depr = con.execute("SELECT * FROM deprecations WHERE api_id = ? LIMIT 1",
                               (d["api_id"],)).fetchone()
            return {"api_name": d["api_name"], "language": d["language"],
                    "library": d["library"], "algorithm": d["algorithm"],
                    "algorithm_variant": d.get("algorithm_variant"),
                    "security_status": d.get("security_status"),
                    "quantum_class": d.get("quantum_class"), "found": True,
                    "quantum_risk": d.get("quantum_class", "UNKNOWN"),
                    "replacement": dict(repl) if repl else None,
                    "deprecation": dict(depr) if depr else None}
        finally:
            con.close()

    def get_quantum_resistance(self, api_name: str) -> dict:
        c = self.classify_api(api_name)
        return {"api_name": api_name, "status": c.get("quantum_class", "UNKNOWN"),
                "rationale": c.get("algorithm", ""),
                "replacement": (c.get("replacement") or {}).get("new_api")}


if __name__ == "__main__":
    kb = CryptoAPIKB()
    print(kb.classify_api("Cipher", "python"))
    print(kb.get_quantum_resistance("MessageDigest"))
