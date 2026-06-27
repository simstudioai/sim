/**
 * Complete Sim.ai Knowledge Base
 * Injected into agent memory for reference during integration generation
 */

export const SIM_KNOWLEDGE = `
# SIM.AI COMPLETE KNOWLEDGE BASE

## 1. ARCHITECTURE - 6-Layer Integration Model

### Layer 1: BLOCK (UI & Routing)
- What user sees in workflow editor
- File: apps/sim/blocks/blocks/{service}.ts
- Contains:
  * type: block ID (e.g., 'stripe')
  * name, description, longDescription
  * category: 'blocks' | 'tools' | 'triggers'
  * integrationType: AI | Analytics | Commerce | Communication | Databases | DevOps | Documents | Email | HR | Marketing | Observability | Productivity | Sales | Search | Security | Support
  * authMode: OAuth | ApiKey | BotToken
  * subBlocks: UI fields (operation dropdown, credentials, file upload, etc)
  * tools.access: list of allowed tool IDs
  * tools.config.tool: function selects tool by params
  * tools.config.params: function normalizes params for tool
  * inputs/outputs: schema
  * triggers.enabled/available: trigger IDs

Block can have 26 capabilities:
1. Display as workflow block
2. Be tool integration
3. Be trigger block
4. Hide via hideFromToolbar
5. Latest-version resolution (V2 pattern)
6. AuthMode (OAuth/ApiKey/BotToken)
7. Operation dropdown
8. Grouped/nested dropdown
9. Conditional fields
10. Basic/advanced fields
11. Trigger-only fields
12. Credential selectors
13. OAuth input
14. File upload fields
15. Various selectors (channel, user, file, sheet, folder, project, knowledge, workflow, document, variables, MCP, table)
16. Dynamic fetchOptions/fetchOptionById
17. dependsOn for cascading selectors
18. reactiveCondition by credential type
19. wandConfig for AI-assisted fields
20. Parameter visibility at subBlock level
21. tools.access list
22. tools.config.tool function
23. tools.config.params normalization
24. inputs schema
25. outputs schema
26. triggers.enabled/available

SubBlock types: short-input, long-input, dropdown, oauth-input, file-upload, channel-selector, user-selector, sheet-selector, folder-selector, project-selector, slider, switch, json, date-picker, time-picker, etc.

SubBlock modes: basic (default), advanced (rare/complex), trigger (trigger context only)

### Layer 2: TOOL (Execution)
- Real action executed: HTTP request, direct execution, OAuth call, etc
- File: apps/sim/tools/{service}/{action}.ts
- Structure:
  * One file per API operation (NOT grouped)
  * index.ts exports all tools
  * types.ts: TypeScript interfaces
- ToolConfig contains:
  * id: snake_case, format {service}_{action}
  * name, description, version (1.0.0 for V1, 2.0.0 for V2)
  * params: with required + visibility (hidden, user-only, user-or-llm, llm-only)
  * outputs: typed, NO guesses
  * request.url(params), request.method(), request.headers(params), request.body(params)
  * request.retry: optional retry rules
  * transformResponse(response, params): ONLY if schema verified
  * postProcess, oauth, errorExtractor, hosting

Tool param visibility:
  - hidden: OAuth tokens, internal system params
  - user-only: API keys, bot tokens, account-specific IDs, webhook secrets
  - user-or-llm: query/filter/content params
  - llm-only: computed values (rare)

Tool outputs:
  - Types: string, number, boolean, json, array, object, file, file[]
  - For json with known structure: MUST have properties
  - For array of objects: MUST have items.properties
  - Optional fields: optional: true
  - Nullable: ?? null in transformResponse
  - Optional arrays: ?? [] in transformResponse

CRITICAL: Never guess outputs. If schema unknown, leave raw or don't write typed transformResponse.

### Layer 3: TRIGGER (Events)
- Webhook or polling trigger
- Files: apps/sim/triggers/{service}/*.ts
- Types:
  * Generic webhook
  * Service-specific webhook
  * Event-specific wrapper
  * Polling trigger
- Trigger outputs must match formatInput keys EXACTLY
- HARD RULE: If webhook payload unknown, cannot guess formatInput or outputs
- Provider handler if needed (HMAC/signature, custom token, auto registration, etc)

### Layer 4: AUTH (Credentials & Security)
- OAuth: centralized scopes in lib/oauth/oauth.ts, not hardcoded
- ApiKey: user-only/password field
- BotToken: user-only/password field
- Rules:
  * Secrets: user-only visibility
  * OAuth tokens: hidden
  * No secrets in outputs/logs
  * Centralize scopes via getScopesForService()

### Layer 5: BlockMeta (Catalog)
- NOT executed by engine
- Used for catalog, templates, suggestions
- Contains:
  * tags: IntegrationTag values (only existing ones)
  * templates: 2-4 example workflows ("Build a workflow that...")
  * skills: suggested actions
  * url: docs link

### Layer 6: DOCS (Generated)
- Auto-generated via: bun run scripts/generate-docs.ts
- Creates: apps/docs/content/docs/en/integrations/{service}.mdx
- Cannot edit manually except manual content block
- Shows: Actions, Triggers, Parameters, Outputs

## 2. REGISTRY SYSTEM

### Block Registry (apps/sim/blocks/registry.ts)
- BLOCK_REGISTRY: { [type]: BlockConfig }
- Functions: getBlock(), getAllBlocks(), getBlockByToolName(), getLatestBlock(), getCanonicalBlocksByCategory(), getBlockMeta(), getTemplatesForBlock(), getSuggestedSkillsForBlock()
- Must register block with type as key
- BlockMeta must be registered separately

### Tool Registry (apps/sim/tools/registry.ts)
- toolRegistry: { [id]: ToolConfig }
- Must register all tools
- Alphabetical order
- Import from {service}/index.ts

### Trigger Registry (apps/sim/triggers/registry.ts)
- TRIGGER_REGISTRY: { [id]: TriggerConfig }
- Alphabetical order
- Primary trigger: includeDropdown: true
- Secondary triggers: no includeDropdown

### Webhook Provider Registry (apps/sim/lib/webhooks/providers/registry.ts)
- WEBHOOK_PROVIDERS: { [service]: WebhookProvider }
- Handler for complex webhook scenarios

### Integration Catalog (apps/sim/lib/integrations/integrations.json)
- Array of catalog entries
- updatedAt timestamp
- Meta: tags, operations, triggers, authType, category

## 3. NAMING & RULES

### IDs & Naming
- Tool IDs: snake_case, format {service}_{action}
- Block type: kebab-case (e.g., stripe, telegram_v2)
- All IDs: snake_case ONLY
- V2 pattern: {service}_v2 suffix

### Visibility Rules
- hidden: OAuth tokens, internal params
- user-only: API keys, credentials, secrets
- user-or-llm: normal operation params
- llm-only: computed values (rare)

### Param Visibility at Phase Level
- Basic params: visible by default
- Advanced params: mode: 'advanced'
- Trigger-only params: mode: 'trigger'
- Credential params: always user-only or hidden

### SubBlock canonical fields pattern
- When you have visual selector (basic) AND manual fallback (advanced):
  * Both link via canonicalParamId
  * canonicalParamId ≠ id
  * Used only for basic/advanced linking
  * inputs/params use canonical IDs

## 4. HARD RULES (NEVER BREAK THESE)

### ❌ NEVER:
1. Guess output fields (if unknown → raw/dynamic)
2. Guess webhook payloads (if unknown → don't implement)
3. Create separate block per operation (always grouped)
4. Group operations into one tool (one per operation)
5. Hardcode OAuth scopes (always centralized)
6. Show secrets to LLM (API keys, tokens)
7. Direct file upload to external API (use internal routes)
8. Break old block without V2 pattern (migration only)
9. Bare JSON outputs (always typed if known)
10. Unknown transformResponse (only if schema verified)
11. formatInput ≠ outputs (must match exactly)
12. Render LLM fields for trigger-only params
13. Export from non-index files
14. Unalphabetical registry
15. Non-snake_case IDs
16. Destructive ops without confirmation
17. Unverified signature verification
18. Non-enum integrationType
19. Duplicated subBlock IDs
20. Broken canonicalParamId links

### ✅ ALWAYS:
1. Verify every schema with docs/examples/live
2. Document source provenance
3. Use centralized OAuth scopes (not hardcoded)
4. Hide sensitive params (visibility: hidden)
5. Mark optional outputs (optional: true)
6. Wire block to all tools
7. Register everything (tools, blocks, triggers)
8. Run type-check before submitting
9. Use alphabetical order in registries
10. Create one tool per API operation
11. Use snake_case for all IDs
12. Validate every output matches docs
13. Hide trigger-only fields from LLM
14. Use ?? null for nullable, ?? [] for optional arrays
15. Grouped block with dropdown (not separate blocks)

## 5. V2 MIGRATION PATTERN

If old integration exists and needs improvement:
- V2 tools: {service}_{action}_v2 suffix, version: 2.0.0
- V2 block: type: {service}_v2
- V1 block: name becomes "Legacy", hideFromToolbar: true
- Registry contains both: {service}, {service}_v2

## 6. FILE HANDLING RULES

If service has file operations:
- Create internal API route: apps/sim/app/api/tools/{service}/{action}/route.ts
- Create API contract: apps/sim/lib/api/contracts/{service}-tools.ts
- Block: file-upload basic + file reference advanced
- Link via canonicalParamId
- Use normalizeFileInput()
- Handle UserFile → Buffer
- Use FileToolProcessor for outputs
- NEVER direct external upload

## 7. DECISION MATRIX

| Has | What to Generate |
|-----|-----------------|
| API operations | Tools |
| UI needed | Block |
| Webhooks | Triggers + provider handler |
| OAuth | Centralized scopes |
| API Key | user-only/password field |
| Files | Internal routes |
| Dynamic resources | Selectors/fetchOptions |
| Catalog visible | BlockMeta + templates |
| Old version exists | V2 pattern |

## 8. SAFETY GATES (Hard Blocks)

Block #1: Unknown response schema
- Cannot write typed transformResponse
- Cannot guess output fields
- Solution: request live credentials OR leave raw/dynamic

Block #2: Unknown webhook payload
- Cannot write formatInput
- Cannot guess outputs
- Solution: request samples OR don't implement

Block #3: Destructive operations
- Cannot auto-execute from LLM
- Cannot hide consequences
- Solution: require human approval OR clear warning

Block #4: No auth docs
- Cannot guess API key format
- Cannot guess OAuth flow
- Solution: find official docs OR implement partial

## 9. INTEGRATION FLOW (11 Phases)

Phase 1: ANALYZE
- Extract: provider, baseUrl, authModel, API summary

Phase 2: EXTRACT
- Find ALL endpoints (exhaustive)
- Record: method, path, params, response, auth, webhooks, files, pagination, errors

Phase 3: CATEGORIZE
- Group endpoints by business domain/resource
- Decide: operation dropdown vs grouped

Phase 4: DESIGN
- Map params to SubBlock types
- Decide: auth mode, basic/advanced fields, selectors
- Build capability matrix

Phase 5: GENERATE TYPES
- TypeScript interfaces for requests/responses
- Only if schema verified

Phase 6: GENERATE TOOLS
- One tool per API operation
- Proper params, visibility, outputs
- Only verified transformResponse

Phase 7: GENERATE BLOCK
- Grouped UI with operation dropdown
- Credential fields
- Basic/advanced pattern
- Tools wiring

Phase 8: GENERATE TRIGGERS (if webhooks)
- Webhook trigger
- Event-specific parsers
- Provider handler (if complex)
- Outputs match formatInput

Phase 9: GENERATE AUTH
- If OAuth: centralized scopes
- If ApiKey: user-only field
- No secrets in outputs

Phase 10: GENERATE META
- BlockMeta: tags, templates, skills
- Catalog entry
- Integration visibility

Phase 11: VALIDATE
- All tools registered
- All blocks registered
- All triggers registered
- type-check passes
- No guessed schemas
- Coverage complete

## 10. COST OPTIMIZATION (DeepSeek v8)

Models:
- deepseek-v3: $0.14/$0.28 per 1M tokens (main)
- deepseek-r1: $0.55/$2.19 per 1M tokens (reasoning)
- deepseek-chat: fallback

KV Cache:
- Cache system message across all phases
- Cached tokens: 90% cheaper
- Per-integration: 20-30% total savings

## 11. GOLDEN RULE

"Better partial integration with honest 'unknown' sections,
 than full integration with hallucinated schemas."

NEVER guess. Mark as unknown instead.

## 12. COMMON INTEGRATIONS TEMPLATE

Every service needs:
- tools/{service}/ (types.ts, index.ts, {action}.ts per operation)
- blocks/blocks/{service}.ts (BlockConfig + BlockMeta)
- triggers/{service}/ if webhooks (utils.ts, index.ts, {event}.ts, webhook.ts)
- lib/webhooks/providers/{service}.ts if complex
- lib/oauth/oauth.ts if OAuth
- components/icons.tsx if icon needed
- docs auto-generated

## 13. VALIDATION CHECKLIST (50+ items)

Source & API ✓
Tools ✓
Block ✓
Triggers ✓
Auth ✓
Files ✓
Docs/Catalog ✓
Final validation ✓

See SPECIFICATION.md for complete 50+ checklist.

## 14. INTEGRTYPE VALUES (Only These Allowed)

AI, Analytics, Commerce, Communication, Databases, DevOps, Documents, Email, HR, Marketing, Observability, Productivity, Sales, Search, Security, Support

## 15. EXAMPLE: Stripe (20+ operations)

Structure:
- tools/stripe/
  * types.ts (Customer, Charge, Subscription, etc)
  * index.ts (export all 20 tools)
  * stripe_customers.ts, stripe_charges.ts, ... (one per category)
- blocks/blocks/stripe.ts
  * BlockConfig with operation dropdown
  * 20 tools in access
  * BlockMeta with templates
- triggers/stripe/ (if webhooks)
  * webhook.ts
  * charge.completed.ts, customer.created.ts, etc
- lib/webhooks/providers/stripe.ts (HMAC verification)
- Registered in all 3 registries + catalog

---

TOTAL: 6 layers, 11 phases, 50+ validation points, 20 hard rules, zero guesses.
`;

export const SIM_ARCHITECTURE_RULES = `
# KEY ARCHITECTURE PATTERNS

## Block Structure
\`\`\`typescript
{
  type: string;                    // kebab-case ID
  name: string;
  description: string;
  category: 'blocks' | 'tools' | 'triggers';
  integrationType: enum;           // MUST be from whitelist
  authMode: 'OAuth' | 'ApiKey' | 'BotToken';
  subBlocks: [{
    id: string;                    // unique within block
    type: string;                  // dropdown, short-input, oauth-input, file-upload, etc
    title: string;
    required?: boolean;
    visibility?: 'user-or-llm' | 'user-only' | 'hidden';
    mode?: 'basic' | 'advanced' | 'trigger';
    canonicalParamId?: string;     // links to canonical param
  }];
  tools: {
    access: string[];              // tool IDs allowed
    config: {
      tool: string;                // function/dynamic
      params: {};                  // mapping function
    };
  };
  inputs?: {};
  outputs?: {};
  triggers?: {
    available: string[];           // trigger IDs
  };
}
\`\`\`

## Tool Structure
\`\`\`typescript
{
  id: string;                      // {service}_{action} (snake_case)
  name: string;
  description: string;
  version: string;                 // 1.0.0 or 2.0.0
  params: {
    [name]: {
      type: 'string' | 'number' | 'boolean' | 'json' | 'file';
      required: boolean;
      visibility: 'hidden' | 'user-only' | 'user-or-llm' | 'llm-only';
      description: string;
    };
  };
  outputs: {
    [name]: {
      type: 'string' | 'number' | 'boolean' | 'json' | 'array' | 'object' | 'file';
      optional?: boolean;
      description: string;
    };
  };
  request: {
    url: string | function;
    method: () => 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: function;
    body?: function;
  };
  transformResponse?: function;   // ONLY if schema verified
}
\`\`\`

## Trigger Structure
\`\`\`typescript
{
  id: string;
  name: string;
  type: 'webhook' | 'polling';
  description: string;
  outputs: { [name]: { type, description } };
  includeDropdown?: boolean;      // true for primary trigger only
  // webhook-specific:
  method?: string;
  path?: string;
  verifyAuth?: function;
  formatInput?: function;         // ONLY if payload verified
}
\`\`\`
`;

export const SIM_CANONICAL_PATTERNS = \`
# Canonical Patterns for Sim.ai Integrations

## 1. OAuth Integration
- Define provider in lib/oauth/oauth.ts
- Centralize scopes: getCanonicalScopesForProvider()
- Block: oauth-input subBlock
- Tool: accessToken visibility hidden
- NEVER hardcode scopes in block

## 2. API Key Integration
- Block: short-input with password: true
- Visibility: user-only
- Tool: receive as param, pass to request
- NEVER show in outputs

## 3. File Upload Integration
- Block: file-upload basic + short-input reference advanced
- canonicalParamId: links both
- Tool: calls internal API route
- Internal route: receives UserFile, uploads to external API
- transformResponse: uses FileToolProcessor for outputs

## 4. Operation Dropdown Pattern
- Block has subBlock: { id: 'operation', type: 'dropdown', ... }
- operation dropdown lists all tool IDs
- tools.config.tool: function returns tool ID based on operation
- tools.config.params: maps operation-specific params

## 5. Basic/Advanced Field Pattern
- Basic field: visual selector (e.g., channel-selector)
  * canonicalParamId: 'channel'
- Advanced field: manual input (e.g., short-input for ID)
  * canonicalParamId: 'channel' (SAME)
- Both link via canonical ID, block chooses one for serialization

## 6. Webhook Trigger Pattern
- webhook.ts: main trigger definition
- {event}.ts: event-specific handlers (e.g., charge.completed.ts)
- outputs MUST match formatInput keys exactly
- provider handler: signature verification, auto-registration

## 7. Polling Trigger Pattern
- No webhook? Use polling
- checkpoints: last poll timestamp
- dedup: by ID or timestamp
- respect API rate limits

## 8. Dynamic Selector Pattern
- fetchOptions: function returns list of available options
- dependsOn: parent param controls child options
- Example: credential → channels dropdown

## 9. Conditional Field Pattern
- condition: function determines if field shown
- Based on: operation selection, auth type, etc
- Example: show API key field only if ApiKey auth mode

## 10. V2 Migration Pattern
- Old block type: {service} → hideFromToolbar: true
- New block type: {service}_v2 → main version
- Tools: {service}_{action}_v2, version: 2.0.0
- Both registered, canonical is V2
\`;
