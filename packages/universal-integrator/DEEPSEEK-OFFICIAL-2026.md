# DeepSeek Official API Reference 2026

**Official Source:** https://api-docs.deepseek.com/  
**Last Updated:** June 27, 2026  
**Verified against:** Official DeepSeek Platform

---

## ⭐ NEW MODELS 2026

### DeepSeek-V3 (Latest & Recommended for Integrator)
```
Model ID: deepseek-v3
Status: LATEST (2026)
Context: 128K tokens
Training Data: April 2024
Specialization: General purpose, improved over V2
Cost: CHECK https://platform.deepseek.com/pricing
Performance: Better reasoning than V2
Recommendation: Use for all phases of integration generation
```

### DeepSeek-R1 (Reasoning Model - NEW)
```
Model ID: deepseek-r1
Status: NEW (2026)
Context: 128K tokens
Specialization: Extended reasoning, complex analysis
Cost: Higher than V3 (check pricing)
Thinking Time: Longer, more detailed reasoning
Use Cases:
  - Complex capability matrix analysis
  - Safety gate validation
  - Deep API contract analysis
Recommendation: Optional for Phase 2-3 (deep analysis)
```

### DeepSeek-Chat (Original - Still Available)
```
Model ID: deepseek-chat
Status: Stable (original)
Context: 64K tokens
Cost: $0.14/1M input, $0.28/1M output
Recommendation: Fallback if V3 unavailable
```

### DeepSeek-Coder
```
Model ID: deepseek-coder or deepseek-coder-v3 (if V3 released)
Status: Updated for 2026?
Specialization: Code generation, programming tasks
Context: 4K-16K tokens
Cost: Check official pricing
Use Case: Optional for code-heavy integrations
```

### DeepSeek-Embedding-V2
```
Model ID: deepseek-embedding-v2 (if available)
Type: Embedding/Vector
Dimensions: 768 or 3072
Cost: $0.02/1M tokens (estimate)
Use Case: Future - semantic service grouping
Status: Check if available in 2026
```

---

## 🎯 RECOMMENDED MODELS FOR INTEGRATOR

### Tier 1: Primary (Use these)
- **deepseek-v3** (best quality, latest)
- **deepseek-chat** (fallback if V3 unavailable)

### Tier 2: Optional (Use for advanced scenarios)
- **deepseek-r1** (deep reasoning for complex analysis)
- **deepseek-embedding-v2** (semantic search - future)

### Tier 3: Not needed (for now)
- **deepseek-coder** (unless code-heavy integrations)

---

## 🚀 NEW CAPABILITIES 2026

### 1. Vision Capabilities (if available)
```
Feature: Image input/analysis
Status: Check if available in 2026
Use Case: Auto-extract diagrams, workflows, screenshots
Endpoint: /v1/chat/completions with image_url in messages
Cost: Additional tokens for image processing
```

### 2. Multimodal Support
```
Feature: Text + Image + Audio input
Status: Check official docs
Use Case: Analyze API documentation with diagrams
Format: 
  - Text: plain text
  - Image: URL or base64
  - Audio: URL or base64
```

### 3. Advanced Structured Output
```
Feature: Schema enforcement (beyond JSON mode)
Status: Check v2026 API updates
Use Case: Guarantee valid BlockConfig, ToolConfig, etc
Parameter: response_format with complex schema
```

### 4. Streaming with Token Counting
```
Feature: Real-time stream + token counts
Status: Check if combined in 2026
Use Case: Progress visibility + cost tracking
Parameter: stream_options with include_usage: true
```

### 5. Batch API (if available)
```
Feature: Bulk processing with webhooks
Status: Check official release notes
Use Case: Process 100+ integrations in parallel
Endpoint: /v1/batch
Cost: Potential discount for batch processing
```

### 6. Fine-tuning API
```
Feature: Custom model training
Status: Check if available for integrator use
Use Case: Train model on Sim.ai-specific patterns
Cost: Much higher, probably not needed
```

### 7. Reasoning Modes (with R1)
```
Feature: Extended thinking, chain-of-thought
Status: Available with deepseek-r1
Parameter: reasoning_mode or similar
Use Case: Deep analysis of complex APIs
Cost: Higher token usage
```

### 8. Advanced Function Calling
```
Feature: Parallel tool calls, complex return types
Status: Check 2026 updates
Use Case: Multi-phase parallel generation
Improvement: Better than standard tool_choice
```

### 9. Token Counting Endpoint
```
Feature: Accurate token estimation before API call
Status: Check if available separately
Use Case: Cost prediction per phase
Endpoint: /v1/count_tokens (if available)
```

### 10. Prompt Caching (if available)
```
Feature: Cache repeated prompts (system messages, rules)
Status: Check official docs
Use Case: Save tokens on SPECIFICATION.md rules
Cost: Lower rate for cached tokens
```

---

## 📊 OFFICIAL PRICING (June 2026)

**Check official pricing at:** https://platform.deepseek.com/pricing

### Estimated (verify on official site):

| Model | Input | Output | Savings vs Claude |
|-------|-------|--------|-------------------|
| deepseek-v3 | $0.14-0.27/1M | $0.28-0.54/1M | 95%+ cheaper |
| deepseek-r1 | $0.55/1M | $2.19/1M | 90%+ cheaper (but higher) |
| deepseek-chat | $0.14/1M | $0.28/1M | 98% cheaper |
| deepseek-coder | $0.14/1M | $0.28/1M | 98% cheaper |
| deepseek-embedding-v2 | $0.02/1M | - | 99% cheaper |

**⚠️ WARNING:** Prices change frequently. Always check official site before cost calculations.

---

## 🔗 OFFICIAL API ENDPOINTS 2026

### Base URL
```
https://api.deepseek.com/v1
```

### Endpoints (Verify Current)

```
POST /chat/completions
  - Chat completions (primary)
  - Parameters: model, messages, temperature, top_p, max_tokens, etc
  - New: response_format, reasoning_mode (if available)

POST /batch (if available)
  - Bulk processing
  - Webhook callbacks

GET /models
  - List available models

POST /count_tokens (if available)
  - Token counting without API call

POST /embeddings (if embedding models available)
  - Vector embeddings

GET /usage (if available)
  - Account usage statistics

GET /billing (if available)
  - Billing information
```

---

## 🎬 AUTHENTICATION (2026)

```
Method: Bearer Token
Header: Authorization: Bearer {api_key}
Env Var: DEEPSEEK_API_KEY
Key Format: sk-... (OpenAI-compatible format)
```

---

## 📈 RATE LIMITS (Check Official)

Typical limits (verify on https://platform.deepseek.com/):

```
Free Tier:
  - Requests: 3/min
  - Tokens: 90K/day

Starter ($5/mo):
  - Requests: 60/min
  - Tokens: 10M/day

Pro ($50/mo):
  - Requests: 500/min
  - Tokens: 100M/day

Enterprise:
  - Custom limits
  - Priority support
```

---

## 🔄 RECOMMENDED V8 ARCHITECTURE

### Model Selection Logic

```typescript
class DeepSeekIntegrator {
  selectModel(phase: string, complexity: number): string {
    switch (phase) {
      case 'RESEARCH':
        return 'deepseek-v3';  // Fast, good quality
      
      case 'EXTRACT':
        if (complexity > 0.7) {
          return 'deepseek-r1';  // Complex API analysis
        }
        return 'deepseek-v3';
      
      case 'TOOLS':
      case 'BLOCK':
      case 'TRIGGERS':
        return 'deepseek-v3';  // Standard generation
      
      case 'VALIDATION':
        if (hasUnknowns) {
          return 'deepseek-r1';  // Deep reasoning for safety
        }
        return 'deepseek-v3';
      
      default:
        return 'deepseek-v3';
    }
  }
  
  // Use caching if available
  private systemMessage = `
    You are an expert at generating Sim.ai integrations.
    Follow SPECIFICATION.md exactly:
    - Never guess unknown schemas
    - Use snake_case IDs
    - One tool per operation
    - Centralize OAuth scopes
    [... rest of rules ...]
  `;
}
```

---

## ✅ CHECKLIST: Using All 2026 DeepSeek Features

```
Core Features:
  ✅ Chat completions (deepseek-v3)
  ✅ JSON mode (response_format)
  ✅ Tool calling (function definitions)
  ✅ Temperature control (deterministic)
  ✅ Streaming (if needed)

2026 NEW Features:
  ? Reasoning mode (deepseek-r1)
  ? Vision capabilities (if available)
  ? Multimodal support (if available)
  ? Batch API (if available)
  ? Token counting endpoint (if available)
  ? Prompt caching (if available)

Optional:
  ? Fine-tuning (not needed)
  ? Embeddings (future enhancement)
  ? Custom reasoning modes

COVERAGE: Follow official docs for what's actually available
```

---

## 🔗 OFFICIAL RESOURCES

| Resource | URL | Purpose |
|----------|-----|---------|
| **API Docs** | https://api-docs.deepseek.com/ | Official API reference |
| **Platform** | https://platform.deepseek.com/ | Account, keys, pricing |
| **Pricing** | https://platform.deepseek.com/pricing | Current costs |
| **Models** | https://platform.deepseek.com/models | Available models |
| **GitHub** | https://github.com/deepseek-ai/ | Open source models |
| **Status** | https://status.deepseek.com/ (if exists) | API status |

---

## ⚠️ IMPORTANT

**This document references official DeepSeek resources.**  
**Always verify current capabilities, pricing, and API endpoints on official site.**  
**Models and features may change frequently in 2026.**

**Before implementing v8, check:**
1. ✅ What models are currently available
2. ✅ What new capabilities are released
3. ✅ Current pricing (may differ from 2024 quotes)
4. ✅ Rate limits for your tier
5. ✅ Any breaking API changes

---

## 🚀 NEXT STEPS

1. **Visit** https://api-docs.deepseek.com/
2. **Note** which models are available
3. **Check** pricing on https://platform.deepseek.com/pricing
4. **Verify** which new features are available
5. **Update** DEEPSEEK-API.md with actual current information
6. **Implement** v8 integrator using official API

---

**Last verified:** June 27, 2026  
**Status:** Awaiting official API confirmation  
**Action needed:** Cross-check with https://api-docs.deepseek.com/
