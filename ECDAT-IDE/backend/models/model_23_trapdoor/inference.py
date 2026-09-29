"""Model 23: Trapdoor IOC — standalone local inference (spec §23)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from trapdoor_db import build_db, check_trapdoor, get_iocs  # noqa: E402


class TrapdoorIOC:
    def __init__(self, model_dir=None):
        self.db = (Path(model_dir) / "trapdoor.sqlite" if model_dir
                   else Path(__file__).resolve().parent / "trapdoor.sqlite")
        if not self.db.exists():
            build_db(self.db)

    def check(self, code_snippet: str = "", algorithm: str = "",
              fingerprint: str = "") -> dict:
        return check_trapdoor({"code_snippet": code_snippet,
                               "algorithm": algorithm,
                               "fingerprint": fingerprint}, self.db)

    def lookup(self, fingerprint: str) -> list[dict]:
        return get_iocs(fingerprint, self.db)


if __name__ == "__main__":
    t = TrapdoorIOC()
    print(t.check(code_snippet="k = RSA.generate(512)"))
    print(t.lookup("dual_ec_drbg_p256")[0]["title"])
