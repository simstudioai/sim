# Guardrails Validators

Validation scripts for the Guardrails block.

## Validators

- **JSON Validation** - Validates if content is valid JSON (TypeScript)
- **Regex Validation** - Validates content against regex patterns (TypeScript)
- **Hallucination Detection** - Validates LLM output against knowledge base using RAG + LLM scoring (TypeScript)
- **PII Detection** - Detects personally identifiable information using Microsoft Presidio (Python)

## Setup

### TypeScript Validators (JSON, Regex, Hallucination)

No additional setup required! These validators work out of the box.

For **hallucination detection**, you'll need:
- A knowledge base with documents
- An LLM provider API key (or use hosted models)

### PII Detection (Presidio sidecar)

PII detection runs against **one** long-lived Presidio sidecar — a combined service (built from
`docker/pii.Dockerfile`, source in `apps/pii/server.py`) that constructs a warm `AnalyzerEngine` +
`AnonymizerEngine` once and exposes both `/analyze` and `/anonymize` (plus `/health`) on a single
port. In deployment it runs alongside the app container in the same ECS task; locally, build and run
it:

```bash
docker build -f docker/pii.Dockerfile -t sim-pii .
docker run -d -p 5001:5001 sim-pii
```

Point the app at it (default shown):

```bash
PII_URL=http://localhost:5001
```

The image bakes in the recognizers itself — a check-digit-validated **VIN** recognizer and
multi-language NLP models (en/es/it/pl/fi) — so the app is a thin HTTP client (`validate_pii.ts`) with
no Python or local venv. The redaction language is configured per rule (Data Retention) and defaults
to English.

## Usage

### JSON & Regex Validation

These are implemented in TypeScript and work out of the box - no additional dependencies needed.

### Hallucination Detection

The hallucination detector uses a modern RAG + LLM confidence scoring approach:

1. **RAG Query** - Calls the knowledge base search API to retrieve relevant chunks
2. **LLM Confidence Scoring** - Uses an LLM to score how well the user input is supported by the retrieved context on a 0-10 confidence scale:
   - 0-2: Full hallucination - completely unsupported by context, contradicts the context
   - 3-4: Low confidence - mostly unsupported, significant claims not in context
   - 5-6: Medium confidence - partially supported, some claims not in context
   - 7-8: High confidence - mostly supported, minor details not in context
   - 9-10: Very high confidence - fully supported by context, all claims verified
3. **Threshold Check** - Compares the confidence score against your threshold (default: 3)
4. **Result** - Returns `passed: true/false` with confidence score and reasoning

**Configuration:**
- `knowledgeBaseId` (required): Select from dropdown of available knowledge bases
- `threshold` (optional): Confidence threshold 0-10, default 3 (scores below 3 fail)
- `topK` (optional): Number of chunks to retrieve, default 10
- `model` (required): Select from dropdown of available LLM models, default `gpt-4o-mini`
- `apiKey` (conditional): API key for the LLM provider (hidden for hosted models and Ollama)

### PII Detection

The PII detector uses Microsoft Presidio to identify personally identifiable information:

1. **Analysis** - Scans text for PII entities using pattern matching, NER, and context
2. **Detection** - Identifies PII types like names, emails, phone numbers, SSNs, credit cards, etc.
3. **Action** - Either blocks the request or masks the PII based on mode

**Modes:**
- **Block Mode** (default): Fails validation if any PII is detected
- **Mask Mode**: Passes validation and returns text with PII replaced by `<ENTITY_TYPE>` placeholders

**Configuration:**
- `piiEntityTypes` (optional): Array of PII types to detect (empty = detect all)
- `piiMode` (optional): `block` or `mask`, default `block`
- `piiLanguage` (optional): Language code, default `en`

**Supported PII Types:**
- **Common**: Person name, Email, Phone, Credit card, Location, IP address, Date/time, URL
- **USA**: SSN, Passport, Driver license, Bank account, ITIN
- **UK**: NHS number, National Insurance Number
- **Other**: Spanish NIF/NIE, Italian fiscal code, Polish PESEL, Singapore NRIC, Australian ABN/TFN, Indian Aadhaar/PAN, and more

See [Presidio documentation](https://microsoft.github.io/presidio/supported_entities/) for full list.

## Files

- `validate_json.ts` - JSON validation (TypeScript)
- `validate_regex.ts` - Regex validation (TypeScript)
- `validate_hallucination.ts` - Hallucination detection with RAG + LLM scoring (TypeScript)
- `validate_pii.ts` - PII detection client: calls the Presidio sidecar's /analyze + /anonymize (TypeScript)
- `pii-entities.ts` - Client-safe PII entity + language catalog (shared by the block and Data Retention)
- `mask-client.ts` - Internal HTTP client for batch PII masking from the log-redaction persist path
- `validate.test.ts` - Test suite for JSON and regex validators

