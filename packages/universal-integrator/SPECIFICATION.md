# SIM.AI Integration Specification v1

**TARGET PLATFORM SPECIFICATION**

Полный регламент для агента, который добавляет новые сервисы в Sim.ai. Это source of truth для всех интеграций.

---

## 0. Главная модель Sim.ai

**Integration = набор скоординированных сущностей:**

```
Block (UI + routing)
+ Tools (executables)
+ Triggers (events)
+ Auth/OAuth/Credentials
+ Icon
+ BlockMeta/Templates/Skills
+ Docs (generated)
+ Registry wiring
+ optional: internal file routes
+ optional: webhook provider handler
+ optional: catalog entry
```

**Это НЕ "просто добавить tool". Это координированная система из 6 слоёв.**

---

## 1. Архитектура по слоям

### 1.1 Block (UI & Routing слой)

**Файл:** `apps/sim/blocks/blocks/{service}.ts`

**Что содержит:**
- `type` — block ID (e.g., `telegram`)
- `name`, `description`, `longDescription`
- `category` — blocks | tools | triggers
- `integrationType` — AI | Analytics | Commerce | Communication | Databases | DevOps | Documents | Email | HR | Marketing | Observability | Productivity | Sales | Search | Security | Support
- `bgColor`, `icon`, `iconColor`
- `authMode` — OAuth | ApiKey | BotToken
- `subBlocks` — UI полей (operation dropdown, credentials, file upload, etc)
- `tools.access` — список разрешённых tool IDs
- `tools.config.tool` — function выбирает tool по params
- `tools.config.params` — function нормализует params для tool
- `inputs` — upstream schema
- `outputs` — downstream schema
- `triggers.enabled`, `triggers.available` — список trigger IDs
- `hideFromToolbar` — скрывает V1 при V2 миграции
- `singleInstance`, `triggerAllowed` — опциональные flags

**Block может делать 26 вещей** (см. раздел 2 ниже).

**Правила:**
- Block — ВСЕГДА grouped, даже если один tool
- Operation dropdown обязателен
- Не создавать отдельный block для каждой операции
- subBlock `id` уникален внутри block
- `canonicalParamId` связывает basic + advanced fields
- `condition` использовать для operation-specific fields
- `mode: advanced` для редких/complex fields

### 1.2 Tool (Execution слой)

**Файл:** `apps/sim/tools/{service}/{action}.ts`

**Структура:**
```
apps/sim/tools/{service}/
├── index.ts           # export all
├── types.ts           # TypeScript interfaces
├── {action}.ts        # каждый tool
├── {action2}.ts
└── {action3}.ts
```

**Что содержит ToolConfig:**
- `id` — snake_case, формат `{service}_{action}`
- `name`, `description`, `version` (1.0.0 для v1, 2.0.0 для v2)
- `params` — с required + visibility (hidden | user-only | user-or-llm | llm-only)
- `outputs` — typed, с optional: true / items для arrays
- `request.url(params)` — template или function
- `request.method()` — GET | POST | PUT | PATCH | DELETE
- `request.headers(params)` — может зависеть от params
- `request.body(params)` — для POST/PATCH
- `request.retry` — опциональные retry rules
- `transformResponse(response, params)` — ТОЛЬКО если schema verified
- `postProcess` — optional post-processing
- `oauth` — OAuth config если нужен
- `errorExtractor` — deterministic error extraction
- `hosting` — для hosted API keys

**Правила:**
- **One tool per API operation** — не группировать в один файл
- **ID всегда snake_case** — `stripe_create_customer`, не `stripeCreateCustomer`
- **Visibility обязателен:** 
  - `hidden` для OAuth tokens, internal system params
  - `user-only` для API keys, credentials, account-specific secrets
  - `user-or-llm` для query/filter/content params
  - `llm-only` для computed values (редко)
- **Params структура:**
  - Каждый param: `{ type, required, visibility, description }`
  - Типы: string | number | boolean | json | file | file[]
  - Complex objects → `json`, не `object`
  - ID fields → trim
- **Outputs:**
  - Типы: string | number | boolean | json | array | object | file | file[]
  - Для json с известной структурой: обязательно `properties`
  - Для array of objects: обязательно `items.properties`
  - Optional fields: `optional: true`
  - Nullable fields: `?? null` в transformResponse
  - Optional arrays: `?? []` в transformResponse
  - **Правило:** нельзя угадывать outputs. Если schema unknown — не писать transformResponse.
- **transformResponse:**
  - Только по documented/example-verified/live-verified schema
  - Не делать bare JSON dump как основной output
  - Извлекать meaningful fields
  - Если schema неизвестна: НЕ писать typed transformResponse
- **Registration:**
  - Import в `apps/sim/tools/registry.ts`
  - Alphabetical order
  - Export из `tools/{service}/index.ts`

### 1.3 Trigger (Event слой)

**Файлы:**
```
apps/sim/triggers/{service}/
├── index.ts
├── utils.ts           # buildOutputs, buildExtraFields, helpers
├── {event_a}.ts       # specific events
├── {event_b}.ts
└── webhook.ts         # main webhook trigger

apps/sim/lib/webhooks/providers/
├── {service}.ts       # provider handler (если нужен)
├── types.ts
├── utils.ts
└── registry.ts
```

**Trigger может быть:**
1. Primary webhook trigger — `includeDropdown: true`
2. Secondary triggers — no dropdown
3. Polling trigger — для services без webhooks
4. Event-specific wrappers

**Trigger outputs:**
- Структура типов: `{ type, description }`
- Вложенные objects поддерживаются
- Optional, items НЕ поддерживаются (только type + description)
- **Hard rule:** если webhook payload не документирована — нельзя угадывать outputs/formatInput

**Provider handler нужен, если:**
- HMAC signature auth
- Custom token auth
- Event filtering
- Idempotency dedupe
- Custom input formatting
- Auto webhook creation/deletion
- Challenge/verification
- Custom success response

**Правила:**
- Outputs должны совпадать с formatInput keys (точно)
- Если они отличаются → downstream fields будут недоступны
- Если webhook payload unknown → не писать formatInput
- Auto registration: если API поддерживает webhook creation:
  - `createSubscription()` 
  - `deleteSubscription()`
  - Throw-safe delete
  - Возвращать `providerConfigUpdates.externalId`
- Registration: все triggers → `TRIGGER_REGISTRY`

### 1.4 Auth / Credentials (Security слой)

**Три основных AuthMode:**

**1. ApiKey**
- Использовать: static key/token
- Требования:
  - `AuthMode.ApiKey`
  - Param visibility: `user-only`
  - `password: true` в block subBlock
  - Не отдавать в outputs
  - Не логировать

**2. OAuth**
- Использовать: требует OAuth connection
- Требования:
  - `AuthMode.OAuth`
  - Block: `oauth-input` subBlock
  - `serviceId` совпадает с OAuth provider ID
  - `requiredScopes` через `getScopesForService(service)`
  - В tool: `accessToken` visibility `hidden`
  - Scopes НЕ хардкодить, только centralized
- Centralization:
  - Определить в `lib/oauth/oauth.ts`
  - Добавить descriptions в `SCOPE_DESCRIPTIONS`
  - Использовать `getCanonicalScopesForProvider()`
  - Использовать `getScopesForService()`

**3. BotToken**
- Использовать: Telegram-like services
- Требования:
  - `AuthMode.BotToken`
  - Field: `user-only`/`password`
  - Не показывать LLM если не нужен как param
  - Не отдавать в outputs

**Webhook Secret (дополнительно):**
- Хранить как `password` field
- `verifyAuth()` в provider handler
- `safeCompare()` для HMAC verification
- Если signature docs unknown → не делать trusted parser

**Parameter Visibility по слоям:**

```
hidden
├─ OAuth accessToken
├─ Internal system params
├─ Credentials (если не нужны как input)

user-only
├─ API keys
├─ Bot tokens
├─ Account-specific IDs
├─ Webhook secrets

user-or-llm
├─ Query parameters
├─ Filter fields
├─ Content fields
└─ Normal operation params

llm-only
├─ Computed values (редко)
```

### 1.5 BlockMeta / Templates / Skills (Catalog слой)

**Файл:** Внутри `apps/sim/blocks/blocks/{service}.ts`

**Содержит:**
```typescript
interface BlockMeta {
  tags: IntegrationTag[]
  url?: string
  templates: BlockTemplate[]
  skills: SuggestedSkill[]
}
```

**Tags (только существующие):**
- AI, Bot, Automation, Communication, CRM, Payment, E-commerce, Data, Analytics, etc.

**Templates:**
- 2–4 штуки per integration
- Конкретные use cases
- Prompt начинается с "Build a workflow that..." или "Create a workflow that..."
- `alsoIntegrations` — другие block types в prompt
- Должны быть реалистичны (не спекулятивны)

**Skills:**
- kebab-case name
- one-line description
- Markdown instructions
- Specific action mapping

**Правило:** Templates/skills только если integration достаточно mature и покрывает real scenarios.

### 1.6 Docs (Generated слой)

**Команда:**
```bash
bun run scripts/generate-docs.ts
```

**Создаёт:**
`apps/docs/content/docs/en/integrations/{service}.mdx`

**Содержит:**
- Actions list
- Triggers list
- Parameters
- Outputs
- Examples
- Manual content block (единственное, что можно редактировать)

**Правило:** Generated docs нельзя редактировать вручную кроме manual block.

### 1.7 Registry (Data слой)

**Главные registries:**

**1. Block Registry**
```
apps/sim/blocks/registry.ts
├─ BLOCK_REGISTRY: { [type]: BlockConfig }
├─ getBlock(type)
├─ getAllBlocks()
├─ getBlockByToolName(toolId)
├─ getLatestBlock(service)
├─ getCanonicalBlocksByCategory(category)
├─ getBlockMeta(type)
├─ getTemplatesForBlock(type)
└─ getSuggestedSkillsForBlock(type)
```

**2. Tool Registry**
```
apps/sim/tools/registry.ts
├─ toolRegistry: { [id]: ToolConfig }
└─ Alphabetical order
```

**3. Trigger Registry**
```
apps/sim/triggers/registry.ts
├─ TRIGGER_REGISTRY: { [id]: TriggerConfig }
└─ Alphabetical order
```

**4. Webhook Provider Registry**
```
apps/sim/lib/webhooks/providers/registry.ts
├─ WEBHOOK_PROVIDERS: { [service]: WebhookProvider }
└─ Auto subscription/deletion handlers
```

**5. Integration Catalog**
```
apps/sim/lib/integrations/integrations.json
├─ Array of integration entries
├─ updatedAt timestamp
└─ Meta: tags, operations, triggers, authType, category
```

---

## 2. Полный список Block возможностей

Block может делать **26 вещей:**

1. ✅ Отображаться как workflow block
2. ✅ Быть tool integration block
3. ✅ Быть trigger block
4. ✅ Быть hidden/superseded через `hideFromToolbar`
5. ✅ Иметь latest-version resolution (`service_v2` canonical)
6. ✅ Иметь AuthMode (OAuth/ApiKey/BotToken)
7. ✅ Иметь operation dropdown
8. ✅ Иметь grouped/nested dropdown
9. ✅ Иметь conditional fields
10. ✅ Иметь basic/advanced fields
11. ✅ Иметь trigger-only fields
12. ✅ Иметь credential selectors
13. ✅ Иметь OAuth input
14. ✅ Иметь file upload fields
15. ✅ Иметь selectors (channel, user, file, sheet, folder, project, knowledge, workflow, document, variables, MCP server, table)
16. ✅ Иметь dynamic fetchOptions / fetchOptionById
17. ✅ Иметь dependsOn для cascading selectors
18. ✅ Иметь reactiveCondition по credential type
19. ✅ Иметь wandConfig для AI-assisted fields
20. ✅ Иметь parameter visibility at subBlock level
21. ✅ Иметь tools.access список
22. ✅ Иметь tools.config.tool function
23. ✅ Иметь tools.config.params normalization
24. ✅ Иметь inputs schema
25. ✅ Иметь outputs schema
26. ✅ Иметь triggers.enabled и triggers.available

**SubBlock modes:**
- `basic` — основное поле
- `advanced` — редкое/complex поле
- `trigger` — только для trigger context
- default: basic

**SubBlock types:**
- `short-input` — строка
- `long-input` — текст
- `dropdown` — enum/list
- `oauth-input` — OAuth credential
- `file-upload` — файл
- `channel-selector` — telegram channel
- `user-selector` — telegram user
- `sheet-selector` — google sheet
- `folder-selector` — папка в облаке
- `project-selector` — проект в CRM
- `slider` — number range
- `switch` — boolean toggle
- `json` — JSON editor
- `date-picker` — дата
- `time-picker` — время
- и другие...

---

## 3. Tool output types & rules

**Supported output types:**

```typescript
string | number | boolean
json | array | object
file | file[]
```

**JSON структура:**
```typescript
{
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    tags: { type: 'array', items: { type: 'string' } }
  }
}
```

**Optional & nullable:**
```typescript
{
  type: 'string',
  optional: true        // может отсутствовать
}

// В transformResponse:
result.field ?? null    // nullable
result.array ?? []      // optional array
```

**Файлы:**
```typescript
{
  type: 'file',
  description: 'Downloaded PDF'
}
{
  type: 'file[]',
  description: 'List of exported CSVs'
}
```

**Array of objects:**
```typescript
{
  type: 'array',
  items: {
    type: 'object',
    properties: { ... }
  }
}
```

**Hard rules:**

- ❌ Не guess output fields
- ❌ Не guess nested paths
- ❌ Не использовать bare `json` если shape known
- ❌ Не делать raw JSON dump как основной output
- ✅ Извлекать meaningful fields
- ✅ Если schema unknown — leave raw / не писать typed transformResponse

---

## 4. Trigger requirements & safety gates

**Trigger outputs vs formatInput:**

```typescript
// MUST совпадать!
trigger.outputs: {
  chatId: string
  messageText: string
  userId: string
}

trigger.formatInput: (body) => ({
  chatId: body.message.chat.id,
  messageText: body.message.text,
  userId: body.from.id
})
```

Если они не совпадают → downstream fields будут недоступны.

**Hard rule для webhook triggers:**

```
Если webhook payload НЕ документирована:
  ❌ Не угадывать payload field names
  ❌ Не угадывать nested paths
  ❌ Не инфировать outputs из UI/marketing docs
  ❌ Не писать formatInput против unverified bodies

  Вместо этого:
  ✅ Попросить sample payloads
  ✅ Запустить тест webhook
  ✅ Использовать только documented events
  ✅ Оставить trigger unimplemented
```

**Polling triggers:**

Если webhook недоступен, но есть timestamp/list operations:
- Реализовать polling trigger
- Checkpoints: last poll time
- Dedup: по ID или timestamp
- Rate limits: соблюдать API limits

---

## 5. File handling rules

Если service поддерживает file operations:

**❌ WRONG:**
```typescript
// Tool напрямую вызывает внешний upload API
export const uploadFileTool: ToolConfig = {
  request.url: () => 'https://api.service.com/upload',
  request.body: (params) => params.file  // ❌ файл напрямую!
}
```

**✅ RIGHT:**
```typescript
// Tool вызывает internal API route
export const uploadFileTool: ToolConfig = {
  request.url: () => '/api/tools/service/upload-file',  // ✅ internal!
  request.body: (params) => ({
    fileId: params.file.id,  // reference, не content
    metadata: params.metadata
  })
}

// Internal API route обрабатывает UserFile
// apps/sim/app/api/tools/service/upload-file/route.ts
export async function POST(request: Request) {
  const { fileId, metadata } = await request.json()
  const userFile = await getUserFile(fileId)
  const buffer = await userFile.buffer()  // ✅ получить content
  // отправить во внешний API
  const response = await externalApi.upload(buffer, metadata)
  return NextResponse.json(response)
}
```

**Правила:**

- ✅ Создать `apps/sim/lib/api/contracts/{service}-tools.ts`
- ✅ Block: `file-upload` basic mode + `short-input` reference advanced
- ✅ Связать через `canonicalParamId`
- ✅ Использовать `normalizeFileInput()`
- ✅ Для outputs использовать `FileToolProcessor`
- ❌ Не загружать файлы напрямую во внешний API

---

## 6. SubBlock canonical fields pattern

**Когда есть visual selector И manual fallback:**

```typescript
{
  // Basic: visual selector
  id: 'channel',
  type: 'channel-selector',
  mode: 'basic',
  title: 'Channel',
  canonicalParamId: 'channel',  // ← связь
  
  // Advanced: manual input
  id: 'channelId',
  type: 'short-input',
  mode: 'advanced',
  title: 'Channel ID (manual)',
  canonicalParamId: 'channel',  // ← та же связь
}
```

**Critical rules:**

- `canonicalParamId` ≠ `id` subBlock
- `canonicalParamId` уникален в operation context
- Используется только для linking basic/advanced alternatives
- `mode` управляет UI visibility, не serialization
- `inputs` и `params` function должны использовать canonical IDs
- Нельзя использовать raw subBlock ids в serialization

---

## 7. V2 migration pattern

Если старая интеграция существует и нужна улучшенная версия:

**Old (V1):**
```typescript
export const telegramBlock: BlockConfig = {
  type: 'telegram',
  name: 'Telegram',
  hideFromToolbar: false,  // ← было видно
  // ...
}
```

**New (V2):**
```typescript
export const telegramV2Block: BlockConfig = {
  type: 'telegram_v2',  // ← новый type
  name: 'Telegram',
  // улучшенные subBlocks, tools, outputs
}

export const telegramLegacyBlock: BlockConfig = {
  type: 'telegram',
  name: 'Telegram (Legacy)',
  hideFromToolbar: true,  // ← скрыто
  // ...
}
```

**В registry:**
```typescript
{
  telegram: telegramLegacyBlock,
  telegram_v2: telegramV2Block  // ← canonical latest
}
```

**Tools V2:**
```typescript
export const telegramSendMessageV2Tool: ToolConfig = {
  id: 'telegram_send_message_v2',  // ← _v2 suffix
  version: '2.0.0',
  // улучшенные params, outputs
}
```

---

## 8. Decision matrix: что и куда добавлять

| Scenario | Tools | Block | Triggers | OAuth | Files | Meta |
|----------|-------|-------|----------|-------|-------|------|
| Single simple API call | ✅ | ✅ grouped | ❌ | (depends) | ❌ | ✅ |
| Multiple operations | ✅+ | ✅ dropdown | ❌ | (depends) | ❌ | ✅ |
| With webhooks | ✅+ | ✅ dropdown | ✅ | (depends) | ❌ | ✅ |
| With files | ✅+ | ✅ file-upload | ❌ | (depends) | ✅ | ✅ |
| OAuth only | ❌ | ✅ oauth-input | ❌ | ✅ | ❌ | ✅ |
| OAuth + webhooks | ✅+ | ✅ all | ✅ | ✅ | ❌ | ✅ |
| Full enterprise | ✅+ | ✅ all | ✅ | ✅ | ✅ | ✅ |
| Just raw API | ✅ generic | API block | ❌ | ❌ | ❌ | ❌ |

---

## 9. Capability matrix — что агент должен определить

**28 вопросов перед начальным кодированием:**

```
API & Operations
[ ] 1. Есть ли outbound API?
[ ] 2. Official OpenAPI/Postman/GraphQL?
[ ] 3. HTML docs only?
[ ] 4. Какие API groups/resources?
[ ] 5. Какие CRUD/search/list/update/delete?
[ ] 6. Есть ли pagination?
[ ] 7. Есть ли batch API?
[ ] 8. Есть ли raw method/endpoint fallback?
[ ] 9. Есть ли rate limits?
[ ] 10. Есть ли idempotency?
[ ] 11. Есть ли destructive operations?

Authentication
[ ] 12. Есть ли auth?
[ ] 13. Auth type: API key / OAuth / bot token / custom?
[ ] 14. Есть ли scopes?
[ ] 15. Есть ли refresh token?
[ ] 16. Есть ли tenant/workspace/account base URL?

Webhooks & Events
[ ] 17. Есть ли webhooks?
[ ] 18. Есть ли webhook signature?
[ ] 19. Есть ли webhook challenge?
[ ] 20. Есть ли event list?
[ ] 21. Есть ли sample payloads?
[ ] 22. Есть ли polling alternative?

Files & Data
[ ] 23. Есть ли file upload?
[ ] 24. Есть ли file download/export?

Integration Considerations
[ ] 25. Уже существует ли old block?
[ ] 26. Нужен ли V2 pattern?
[ ] 27. Нужны ли dynamic selectors?
[ ] 28. Нужны ли templates/skills?
```

**После ответов:**
- Построить integration plan
- Выбрать какие операции native
- Решить grouped vs simple UI
- Решить нужен ли raw fallback

---

## 10. Safety gates — что блокирует добавление

**Hard block #1: Unknown response schema**

```
Если response schema НЕ документирована:
  ❌ Нельзя писать typed transformResponse
  ❌ Нельзя выдумывать output fields
  ❌ Нельзя инфировать из примеров
  
  Решение:
  ✅ Запросить live credentials
  ✅ Запросить example responses
  ✅ Или оставить tool raw/dynamic
```

**Hard block #2: Unknown webhook payload**

```
Если webhook payload НЕ документирована:
  ❌ Нельзя писать formatInput
  ❌ Нельзя выдумывать trigger outputs
  ❌ Нельзя инфировать nested paths
  
  Решение:
  ✅ Запросить sample payloads
  ✅ Запустить тест webhook
  ✅ Или не реализовывать trigger
```

**Hard block #3: Destructive operations**

```
Если operation DELETE/CANCEL/DESTROY:
  ❌ Нельзя auto-execute от LLM
  ❌ Нельзя недокументированные последствия
  
  Решение:
  ✅ Require human approval
  ✅ Or llm-only=false
  ✅ Clear confirmation in description
```

**Hard block #4: No authentication docs**

```
Если auth mechanism unclear:
  ❌ Нельзя guess API key format
  ❌ Нельзя guess OAuth flow
  ❌ Нельзя guess signature verification
  
  Решение:
  ✅ Find official security docs
  ✅ Request from support
  ✅ Or implement partial integration
```

---

## 11. Flow диаграмма агента

```
START: Service URL / Name
  ↓
PHASE 1: RESEARCH
  ├─ Find official docs
  ├─ Find API reference  
  ├─ Find auth docs
  ├─ Find webhook docs (if any)
  ├─ Find file docs (if any)
  ├─ Mark sources + provenance
  └─ GATE: All critical docs found?
     ├─ NO → block until source located
     └─ YES → continue
  ↓
PHASE 2: CONTRACT EXTRACTION
  ├─ Extract all operations
  ├─ Group by resource
  ├─ For each operation:
  │   ├─ method, path, params
  │   ├─ request body
  │   ├─ response schema
  │   ├─ assign schemaStatus: documented|example_verified|live_verified|partial|unknown
  │   ├─ pagination?
  │   ├─ auth/scopes?
  │   └─ errors?
  ├─ Extract auth mechanism
  ├─ Extract webhooks + payloads
  ├─ Extract files operations
  └─ GATE: Safety checks
     ├─ Unknown response → mark unsafe
     ├─ Unknown webhook → mark unsafe
     ├─ Destructive ops → mark unsafe
     └─ Continue with marked unknowns
  ↓
PHASE 3: INTEGRATION PLANNING
  ├─ Build capability matrix
  ├─ Decide: tools only / block+tools / full?
  ├─ Decide: V1 or V2?
  ├─ Decide: operation dropdown or grouped?
  ├─ Decide: what's native vs raw fallback?
  ├─ Decide: file routes?
  ├─ Decide: triggers?
  ├─ Decide: OAuth?
  ├─ Decide: catalog visible?
  └─ Write integration plan
  ↓
PHASE 4: TOOLS GENERATION
  ├─ Create types.ts
  ├─ For each operation:
  │   ├─ Create {action}.ts
  │   ├─ id snake_case
  │   ├─ params with required+visibility
  │   ├─ request matching API docs
  │   ├─ outputs only if verified
  │   ├─ transformResponse only if verified
  │   └─ Register in index.ts
  ├─ Register in tools/registry.ts
  └─ VALIDATE: Every tool
     ├─ Check params vs docs
     ├─ Check request mapping
     ├─ Check outputs verified
     └─ Check registration
  ↓
PHASE 5: BLOCK GENERATION
  ├─ Create {service}.ts
  ├─ BlockConfig:
  │   ├─ operation/resource dropdowns
  │   ├─ credential fields
  │   ├─ basic/advanced pattern
  │   ├─ tools.access
  │   ├─ tools.config.tool
  │   ├─ tools.config.params
  │   ├─ inputs/outputs
  │   └─ triggers if any
  ├─ BlockMeta:
  │   ├─ tags
  │   ├─ templates
  │   └─ skills
  ├─ Register in blocks/registry.ts
  ├─ Register BlockMeta
  └─ VALIDATE: Block wiring
     ├─ All subBlocks mapped to tool params
     ├─ operations cover all tools
     └─ outputs match tool outputs
  ↓
PHASE 6: TRIGGERS GENERATION (if webhooks)
  ├─ Create triggers/{service}/
  ├─ For each event:
  │   ├─ Create {event}.ts
  │   ├─ outputs only if payload verified
  │   ├─ formatInput keys = outputs keys
  │   └─ Register
  ├─ Create webhook.ts
  ├─ If provider handler needed:
  │   ├─ Create lib/webhooks/providers/{service}.ts
  │   ├─ HMAC/signature if documented
  │   ├─ Auto registration if supported
  │   └─ Register in provider registry
  ├─ Wire block.triggers
  └─ VALIDATE: Trigger outputs
     ├─ Outputs match formatInput
     ├─ No guessed payloads
     └─ All events documented
  ↓
PHASE 7: AUTH WIRING
  ├─ If OAuth:
  │   ├─ Add to lib/oauth/oauth.ts
  │   ├─ Define scopes (centralized)
  │   ├─ Add SCOPE_DESCRIPTIONS
  │   ├─ Block: oauth-input
  │   ├─ Tool: hidden accessToken
  │   └─ Use getScopesForService()
  ├─ If API key:
  │   ├─ user-only/password field
  │   └─ Pass to tool params
  └─ VALIDATE: No secrets in outputs/logs
  ↓
PHASE 8: FILE HANDLING (if files)
  ├─ Create internal API routes
  ├─ Create API contracts
  ├─ Block: file-upload basic + reference advanced
  ├─ canonicalParamId linking
  ├─ normalizeFileInput()
  ├─ FileToolProcessor for outputs
  └─ VALIDATE: UserFile handling correct
  ↓
PHASE 9: ICONS
  ├─ Обновить apps/sim/components/icons.tsx
  ├─ Add {Service}Icon component
  └─ Use in BlockConfig
  ↓
PHASE 10: DOCS GENERATION
  ├─ bun run scripts/generate-docs.ts
  ├─ Verify docs created
  ├─ Check Actions section
  ├─ Check Triggers section
  └─ VALIDATE: Docs complete
  ↓
PHASE 11: FINAL VALIDATION
  ├─ type-check passes
  ├─ lint passes
  ├─ Every output backed by docs
  ├─ No guessed schemas
  ├─ No broken canonicalParamId
  ├─ All tools registered
  ├─ All blocks registered
  ├─ All triggers registered
  └─ Report issues
  ↓
END: Integration ready
  ├─ All 6 layers generated
  ├─ All tests passed
  ├─ Full validation passed
  └─ Open PR with coverage
```

---

## 12. Validation checklist

### Source / API

```
[ ] Official docs found
[ ] Official API reference found
[ ] Auth docs found
[ ] Webhook docs checked
[ ] File docs checked
[ ] Rate limit docs checked
[ ] Pagination docs checked
[ ] Error schema checked
[ ] Response schemas verified or marked unknown
[ ] Payload schemas verified or marked unknown
[ ] Source URLs recorded
```

### Tools

```
[ ] apps/sim/tools/{service}/ created
[ ] types.ts created
[ ] one file per operation
[ ] index.ts exports all tools and types
[ ] all IDs snake_case
[ ] all params have required: true|false
[ ] all params have correct visibility
[ ] request mapping matches API docs
[ ] transformResponse only if schema verified
[ ] nullable fields use ?? null
[ ] optional arrays use ?? []
[ ] optional outputs have optional: true
[ ] no raw JSON dump for known schemas
[ ] registered in tools/registry.ts
[ ] alphabetical import order
```

### Block

```
[ ] apps/sim/blocks/blocks/{service}.ts created
[ ] BlockConfig complete
[ ] BlockMeta complete
[ ] valid integrationType from enum
[ ] tags only in BlockMeta
[ ] operation/resource dropdowns complete
[ ] subBlocks cover all required params
[ ] optional params marked advanced
[ ] canonicalParamId correct
[ ] tools.access lists all tools
[ ] tools.config.tool function complete
[ ] tools.config.params function complete
[ ] inputs schema complete
[ ] outputs schema complete
[ ] registered in blocks/registry.ts
[ ] BlockMeta registered
[ ] hideFromToolbar correct for V1 migration
```

### Auth

```
[ ] AuthMode correct (OAuth|ApiKey|BotToken)
[ ] API keys have user-only/password
[ ] OAuth tokens have hidden visibility
[ ] OAuth scopes centralized (not hardcoded)
[ ] getScopesForService() used
[ ] no secrets in outputs
[ ] no secrets in logs
[ ] password fields not shown to LLM
```

### Triggers

```
[ ] webhook docs checked
[ ] no guessed payload schemas
[ ] utils.ts created
[ ] primary trigger has includeDropdown: true
[ ] secondary triggers no includeDropdown
[ ] outputs documented
[ ] provider handler created if needed
[ ] HMAC signature verification if documented
[ ] formatInput keys match outputs exactly
[ ] idempotency ID if possible
[ ] auto subscription if supported
[ ] all triggers registered
[ ] block.triggers.available wired
[ ] getTrigger(id).subBlocks spread in block
```

### Files

```
[ ] file-upload basic field added
[ ] advanced file reference field
[ ] canonicalParamId correct
[ ] normalizeFileInput used
[ ] internal API route created
[ ] API contract schema created
[ ] UserFile handled correctly
[ ] FileToolProcessor used for outputs
[ ] no direct external upload
```

### Docs / Catalog

```
[ ] Icon added to icons.tsx or placeholder noted
[ ] BlockMeta templates added (if applicable)
[ ] Suggested skills added
[ ] integration.json catalog entry (if applicable)
[ ] docs generated via script
[ ] generated docs verified (Actions + Triggers)
[ ] manual content only in allowed block
```

### Final Validation

```
[ ] type-check passes
[ ] lint passes
[ ] every output backed by docs or live sample
[ ] no unknown transformResponse
[ ] no guessed webhook formatInput
[ ] no duplicate subBlock IDs
[ ] no broken canonicalParamId links
[ ] no unregistered tools/triggers/blocks
[ ] registry alphabetical order
[ ] integration.json updated if needed
[ ] docs generation completed
[ ] all links working
```

---

## 13. Hard rules & prohibitions

### ❌ НИКОГДА не делать:

1. **Guess output fields** — если schema unknown → raw/dynamic mode
2. **Guess webhook payloads** — если payload unknown → не реализовывать trigger
3. **Create separate block per operation** — всегда grouped с dropdown
4. **Group operations into one tool** — one tool per operation
5. **Hardcode OAuth scopes** — всегда centralized
6. **Show secrets to LLM** — API keys, tokens → user-only
7. **Direct file upload to external API** — всегда internal route
8. **Break old block without V2 pattern** — миграция только через V2
9. **Bare JSON outputs** — всегда typed/meaningul fields
10. **Unknown transformResponse** — только по verified schema
11. **formatInput≠outputs** — должны совпадать точно
12. **Render LLM fields for trigger-only params** — скрывать от LLM
13. **Export from non-index files** — imports только из {service}/index.ts
14. **Unalphabetical registry** — всегда alphabetical order
15. **Non-snake_case IDs** — tool IDs ТОЛЬКО snake_case
16. **Destructive ops без confirmation** — требовать human approval
17. **Unverified signature verification** — только по docs
18. **Non-enum integrationType** — только существующие значения
19. **duplicated subBlock IDs** — уникальны внутри block
20. **Broken canonicalParamId** — всегда связывают basic+advanced

### ✅ ВСЕГДА делать:

1. Verify every schema with docs/examples/live
2. Document source provenance
3. Use centralized OAuth scopes
4. Hide sensitive params (visibility: hidden)
5. Mark optional outputs (optional: true)
6. Use ?? null for nullable, ?? [] for optional arrays
7. Wire block to all tools (tools.access, tools.config)
8. Register everything (tools, blocks, triggers)
9. Validate every output matches docs
10. Run type-check before submitting
11. Use alphabetical order in registries
12. Create one tool per API operation
13. Use snake_case for all IDs
14. Use centralized OAuth/auth
15. Hide trigger-only fields from LLM

---

## 14. Итоговая формула

```
New Sim.ai Integration =
  VERIFIED API knowledge
  + TYPED tools (no guess)
  + USABLE block UX (grouped dropdown)
  + SAFE auth (centralized scopes)
  + OPTIONAL triggers (only documented payloads)
  + OPTIONAL file routes (internal handling)
  + CATALOG/docs/meta (visible to users)
  + STRICT validation (all checklist passed)
  + NO hallucinated schemas (marked unknown if needed)
```

**Главный принцип:**

> Лучше partial integration с honest "unknown" sections,
> чем full integration с hallucinated schemas.

---

## 15. Какой путь агент должен выбрать

**Для ЛЮБОГО сервиса:**

```
if unknown API docs:
  → find official sources or block

if unknown response schema:
  → request examples or mark unsafe

if unknown webhook payloads:
  → request samples or don't implement trigger

if destructive operations:
  → require human approval

if capability matrix shows need for:
  → tools → generate
  → block → generate
  → triggers → generate
  → oauth → generate
  → files → generate
  → meta → generate

then:
  → register all
  → validate all
  → generate docs
  → report coverage
```

**Результат:**

```
Phase 1-3:  Research + planning (30%)
Phase 4-9:  Generation (40%)
Phase 10-12: Docs + validation (30%)

Total time: ~30 min for well-documented API
Total cost: $1.50-2.50 (DeepSeek)
Quality: Production-grade, no guesses
```

---

## 16. Exit criteria

**Integration is COMPLETE when:**

```
✅ All 6 layers generated
✅ Block has grouped operation dropdown
✅ All tools have real, documented outputs
✅ All tool params have correct visibility
✅ No guessed schemas anywhere
✅ Triggers registered if webhooks
✅ OAuth centralized if needed
✅ File routes internal if files
✅ BlockMeta + catalog
✅ Docs generated
✅ type-check passes
✅ All validations passed
✅ Coverage report generated
```

**If any validation fails:**

```
→ Fix only proven issues (not guesses)
→ Revalidate
→ Report exact unknowns
→ Open PR with honest coverage
```

---

**VERSION: 1.0 (May 2026)**

**This is the source of truth for all Sim.ai integrations.**

**Agent must follow this specification exactly.**
