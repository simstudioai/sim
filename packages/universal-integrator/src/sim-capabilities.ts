/**
 * sim-capabilities.ts
 *
 * The COMPLETE map of what sim.ai supports. Injected into the agent prompt so it
 * uses the RIGHT construct for every API feature instead of always emitting a
 * generic ToolConfig. Sourced from sim's CONTRIBUTING.md, CLAUDE.md, docs.sim.ai,
 * and the live block/tool registries (June 2026).
 *
 * Keep this as a single exported string so prompt.ts can embed it verbatim.
 */

export const SIM_CAPABILITIES = `
================================================================
SIM.AI CAPABILITY MAP — use the RIGHT construct per API feature
================================================================

Sim.ai integrations are NOT just "a ToolConfig". A complete integration may use
several of the following. Decide which apply to the target service and implement
ALL that fit.

----------------------------------------------------------------
1) BLOCK CATEGORIES (BlockConfig.category)
----------------------------------------------------------------
- 'tools'    → external service integration (the usual case for a new API)
- 'blocks'   → core flow primitives (you normally do NOT create these)
- 'triggers' → blocks that START a workflow (see TRIGGERS below)

Core blocks that ALREADY EXIST (never recreate; reference them in longDescription
when relevant): Agent, API, Condition, Router, Function, Evaluator, Guardrails,
Human in the Loop, Loop, Parallel, Response, Variables, Wait, Workflow, Webhook,
Credential, Knowledge, Memory. A new service integration is almost always
category:'tools'.

----------------------------------------------------------------
2) AUTH MODELS — pick the one the API actually uses
----------------------------------------------------------------
A) OAuth2 (preferred when the service supports it):
   - In ToolConfig: set  provider: '<oauthProviderId>'  and an oauth block:
       oauth: { required: true, provider: '<providerId>',
                additionalScopes: ['scope.a','scope.b'] }
   - The access token is injected at runtime → param visibility 'hidden':
       accessToken: { type:'string', required:true, visibility:'hidden' }
   - In BlockConfig add a credential selector subBlock:
       { id:'credential', title:'Account', type:'oauth-input',
         provider:'<providerId>', required:true }
   - Sim auto-refreshes tokens and supports multiple connected accounts.
   - If the provider is NEW to sim, note that an OAuth provider registration is
     also required (apps/sim/lib oauth registry) — flag this in the report.

B) API key (header or query):
   apiKey: { type:'string', required:true, visibility:'user-only', ... }
   subBlock: { id:'apiKey', title:'API Key', type:'short-input',
               password:true, required:true }

C) Bearer token: same as API key but header 'Authorization: Bearer <key>'.

D) Webhook URL embeds creds (Bitrix24-style):
   webhookUrl: { type:'string', required:true, visibility:'user-only' }
   url builder appends the method name to webhookUrl.

E) Basic auth: username + password (both visibility:'user-only'), header uses btoa.

F) Sim hosted keys: some tools allow Sim's hosted API key so the user needs none.
   Only applies if Anthropic/Sim hosts that provider — usually NOT for a new 3rd party.

----------------------------------------------------------------
3) SUBBLOCK TYPES (the BlockConfig UI vocabulary) — use the right input
----------------------------------------------------------------
Common 'type' values for subBlocks (match the param's nature):
- 'short-input'    → single-line text (IDs, keys, names). password:true to mask.
- 'long-input'     → multi-line text (messages, prompts, bodies).
- 'dropdown'       → fixed option set. options:[{label,id}], value:()=>'default'.
- 'combobox'       → dropdown + free text (e.g. model names).
- 'slider'         → numeric range. min/max/step (temperature, limits).
- 'switch'         → boolean toggle.
- 'checkbox-list'  → multiple booleans.
- 'oauth-input'    → OAuth account selector (provider:'<id>'). For OAuth auth.
- 'file-selector'  → pick a file from a connected provider (Drive/Box/etc).
- 'file-upload'    → upload a UserFile (see FILE HANDLING).
- 'code'           → code editor (language option), for code/script params.
- 'json' / 'json-editor' → structured JSON (filters, payloads).
- 'table'          → key/value rows (headers, query params).
- 'time-input' / 'date-input' → temporal params.
- 'channel-selector','project-selector', etc → provider-specific pickers when they exist.

SubBlock common properties (besides id/title/type):
- required: true
- placeholder: '...'
- password: true                 // mask value (secrets)
- value: () => 'default'         // default value
- options: [{label,id}]          // for dropdown/combobox
- min / max / step               // for slider
- condition: { field:'operation', value:'send' }   // show only when another field matches
        also supports value arrays and { field, not:true } / nested and/or
- dependsOn: ['credential']      // clear/refresh this field when a dep changes
- mode: 'basic' | 'advanced'     // progressive disclosure; 'basic'/'advanced' tabs
- layout/half-width hints where supported

USE 'condition' to show operation-specific params only for their operation. This
is how ONE block cleanly supports many operations without a cluttered UI.

----------------------------------------------------------------
4) PARAMETER VISIBILITY (4 levels — pick correctly per param)
----------------------------------------------------------------
| visibility   | User UI | LLM may set | Use for                                  |
| user-only    |  yes    |  no         | API keys, config, limits, credentials    |
| user-or-llm  |  yes    |  yes        | core content (query, message, subject)   |
| llm-only     |  no     |  yes        | values only the LLM should compute       |
| hidden       |  no     |  no         | runtime-injected (OAuth token, internal) |
Credentials are ALWAYS user-only (API key) or hidden (OAuth token). NEVER expose
secrets to the LLM.

----------------------------------------------------------------
5) TOOLCONFIG.request — full surface
----------------------------------------------------------------
- url:    (params) => string                 // function; supports path params
- method: 'GET'|'POST'|... or (params)=>verb
- headers:(params) => Record<string,string>  // auth + content negotiation
- body:   (params) => object|FormData|undefined  // exclude auth/meta fields
- query:  (params) => Record<string,string>  // when params go in query string
- isInternalRoute / route patterns for file-handling tools (see FILE HANDLING)
- NOTE: tools.config.tool runs at SERIALIZATION (before variable resolution) —
  do NOT do Number()/coercion there or dynamic <Block.output> refs break.
  Put type coercions in tools.config.params (runs at execution).

----------------------------------------------------------------
6) RESPONSE — transformResponse / outputs / files / pagination
----------------------------------------------------------------
- transformResponse: async (response, params?) => ({ success, output, ... })
  Cover error shapes: error.message → error → message → description(Telegram) →
  error_description(Bitrix24) → errors[0].message → detail(FastAPI).
- Unwrap: result/data/items; preserve pagination (cursor/nextOffset/total/hasMore).
- File outputs: a tool may return file-typed output with {name, mimeType, size},
  data as buffer | base64 | URL. Declare such outputs in BlockConfig.outputs.
- Streaming: some tools stream; if the API streams, note it (sim supports streamed
  responses for agent/LLM tools).
- Retries: tools support retry config (maxRetries, initial/max delay) where needed.

----------------------------------------------------------------
7) FILE HANDLING (uploads/downloads)
----------------------------------------------------------------
- Inputs use 'file-upload' subBlock → UserFile objects; normalize with
  normalizeFileInput and the basic/advanced mode pattern.
- For tools that upload/download, ROUTE THROUGH AN INTERNAL API ENDPOINT
  (apps/sim/app/api/tools/<provider>/<action>/route.ts) rather than calling the
  external API directly from the tool. Multipart/form-data is built server-side.
- Declare file outputs with metadata (name, mimeType, size).

----------------------------------------------------------------
8) TRIGGERS (when the service can START workflows)
----------------------------------------------------------------
If the API emits events / supports incoming webhooks, ALSO provide a trigger:
- Trigger blocks live in apps/sim/triggers/ and register in triggers/registry.ts.
- A block can run in TRIGGER MODE: trigger-only subBlocks are tagged so they show
  only in trigger mode (e.g. event filters, secret/clientState).
- Webhook auth patterns: shared secret, signature verification (HMAC), or
  provider clientState verification (e.g. Teams). Implement the verification the
  provider documents.
- Provide: subscription setup (if the API needs registering a webhook), event
  payload typing, and dedup if the provider may resend.
- If the service only supports polling, document using the Schedule trigger +
  this block's "list/get since" operation instead of a push trigger.

----------------------------------------------------------------
9) AGENT-TOOL vs STANDALONE
----------------------------------------------------------------
Every tool you create is usable BOTH as a standalone block (deterministic) AND as
an agent tool (LLM decides when to call). Get visibility right so the agent-tool
experience is clean:
- expose user-or-llm for the content params the LLM should fill,
- keep config/secrets user-only,
- write descriptive 'description' fields (the LLM reads them to choose the tool).
Tool execution modes in Agent blocks: Auto / Required / None.

----------------------------------------------------------------
10) MULTI-TOOL DISTRIBUTION (how to split a big API correctly)
----------------------------------------------------------------
- One tool file per CATEGORY (resource/domain). 3–12 actions each. Split >15,
  merge <3.
- Tool id '{provider}_{category}'. Each action selected via an 'action'/'operation'
  param; url/method/body branch on it.
- Alternatively (smaller APIs), one tool per ACTION ('{provider}_{action}') as the
  Pinecone example does (pinecone_fetch, pinecone_search_text). Choose per API size:
    * Few endpoints (<~10): one tool per action (cleaner, matches sim examples).
    * Many endpoints: group into category tools with an operation selector.
- BlockConfig.operation dropdown lists ALL operations grouped by category;
  tools.config.tool maps operation → tool id.
- Ensure EVERY endpoint from the API is mapped to exactly one action. Do not drop
  endpoints; if you intentionally defer some, list them as TODO in the report.

----------------------------------------------------------------
11) REGISTRIES & DOCS (must update or the integration is invisible)
----------------------------------------------------------------
- apps/sim/blocks/registry.ts  → add { <provider>: <Provider>Block } (alphabetical)
- apps/sim/tools/index.ts       → add every tool id → tool
- apps/sim/triggers/registry.ts → if you added a trigger
- apps/sim/components/icons.tsx → add <Provider>Icon
- run ./scripts/generate-docs.sh → generates docs entry
- i18n / integrations.json landing data may need an entry (note in report)

----------------------------------------------------------------
12) DECISION CHECKLIST (apply per service)
----------------------------------------------------------------
[ ] Auth model chosen (OAuth2 / apiKey / bearer / webhookUrl / basic / hosted)?
[ ] If OAuth: provider id + scopes + oauth-input credential subBlock + hidden token?
[ ] Every endpoint mapped to an action; categories sized 3–12?
[ ] One-tool-per-action (small API) vs category-tools (large API) decided?
[ ] Correct subBlock TYPE per param (slider/json/file-upload/dropdown/…)?
[ ] condition/dependsOn/mode used so operation-specific fields show contextually?
[ ] Visibility correct for every param (secrets user-only/hidden)?
[ ] File upload/download → internal route + UserFile + file outputs?
[ ] Events/webhooks → trigger block + verification + dedup (or Schedule fallback)?
[ ] Pagination surfaced in outputs?
[ ] All registries updated + icon + generate-docs?
`
