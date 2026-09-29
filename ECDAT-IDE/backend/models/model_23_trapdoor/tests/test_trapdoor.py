import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from trapdoor_db import build_db, check_trapdoor, get_iocs


def test_build_and_lookup(tmp_path):
    db = tmp_path / "t.sqlite"
    assert build_db(db) >= 6
    assert get_iocs("dual_ec_drbg_p256", db)[0]["ioc_id"] == "TRAP-001"


def test_check_hit_and_miss(tmp_path):
    db = tmp_path / "t.sqlite"
    build_db(db)
    assert check_trapdoor({"code_snippet": "use Dual_EC_DRBG here"}, db)["match"]
    assert not check_trapdoor({"code_snippet": "AESGCM(key).encrypt(n, p, None)"}, db)["match"]
