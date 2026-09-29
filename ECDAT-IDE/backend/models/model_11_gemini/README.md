# Model 11: Gemini Cloud Router & NVD Ingestion

Cloud fallback for high-complexity crypto reasoning (replaces GPT-4o-mini).
Spec: `doc/ECDAT_AI_ML_MODELS.md` §11.

- Default model: `gemini-3.6-flash` (override via `MODEL11_GEMINI_MODEL`; free tier rate-limited; paid $1.50/$7.50 per 1M)
- Tiers: Gemini API → local Ollama → deterministic offline engine (no key needed for Tier 3)
- Budget guard caps cloud fallback at <= 5% of daily requests (`MODEL11_BILLING=paid` to accrue cost, else $0)

```powershell
$env:GEMINI_API_KEY = "<ai-studio-key>"
python -m models.model_11_gemini.setup_cloud
pytest models/model_11_gemini/tests/test_model11_gemini.py -v
```

Gateway: `POST /api/v1/llm/generate` with `"model": "gemini_flash"` (served by `class-b-gpu` image).
