# Model 23: Trapdoor IOC Database

SQLite + pattern/hash lookup for known crypto backdoors (spec `ECDAT_AI_ML_MODELS` §23).

- Seed data: `data/trapdoor_iocs.json` (6 IOC families: Dual_EC_DRBG, Debian weak keys,
  static ECDSA nonces, export-grade RSA, embedded keys, compromised certs)
- API: `trapdoor_db.check_trapdoor(finding)`, `trapdoor_db.get_iocs(fingerprint)`
- Served by: `class-a-cpu` as `trapdoor` → gateway `POST /api/v1/security/trapdoor`
- Test: `pytest models/model_23_trapdoor/tests/test_trapdoor.py`
