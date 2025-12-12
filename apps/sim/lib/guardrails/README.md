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

### Python Validators (PII Detection)

For **PII detection**, you need to set up a Python virtual environment and install Microsoft Presidio:

```bash
cd apps/sim/lib/guardrails
./setup.sh
```

This will:
1. Create a Python virtual environment in `apps/sim/lib/guardrails/venv`
2. Install required dependencies:
   - `presidio-analyzer` - PII detection engine
   - `presidio-anonymizer` - PII masking/anonymization

The TypeScript wrapper will automatically use the virtual environment's Python interpreter.

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
- `validate_pii.ts` - PII detection TypeScript wrapper (TypeScript)
- `validate_pii.py` - PII detection using Microsoft Presidio (Python)
- `validate.test.ts` - Test suite for JSON and regex validators
- `validate_hallucination.py` - Legacy Python hallucination detector (deprecated)
- `requirements.txt` - Python dependencies for PII detection (and legacy hallucination)
- `setup.sh` - Legacy installation script (deprecated)

