# SIM Universal Integrator v8 - Architecture

## Понимание Sim.ai интеграций

В Sim.ai **коннектор** состоит из 6 слоёв:

### 1. **Block** (UI слой)
```
apps/sim/blocks/blocks/{service}.ts
```
- Что видит пользователь в workflow editor
- UI-поля (subBlocks) для input параметров
- operation dropdown для выбора action
- auth mode (OAuth, ApiKey, BotToken)
- inputs/outputs mapping
- triggers.available

**Пример:**
```typescript
export const TelegramBlock: BlockConfig = {
  type: 'telegram',
  name: 'Telegram',
  category: 'tools',
  authMode: 'api_key',
  subBlocks: [
    { id: 'operation', type: 'dropdown', title: 'Operation', enum: ['send_message', 'send_photo', ...] },
    { id: 'chatId', type: 'short-input', title: 'Chat ID', visibility: 'user-or-llm' },
    { id: 'text', type: 'long-input', title: 'Message Text', visibility: 'user-or-llm' },
  ],
  tools: { access: ['telegram_send_message', 'telegram_send_photo', ...] },
  triggers: { available: ['telegram_webhook'] }
}
```

### 2. **Tool** (Execution слой)
```
apps/sim/tools/{service}/{action}.ts
apps/sim/tools/{service}/types.ts
apps/sim/tools/{service}/index.ts
```
- Исполняемое API-действие
- HTTP request (url, method, headers, body)
- params с visibility (user-or-llm, user-only, llm-only, hidden)
- outputs definition
- errorExtractor, postProcess, transformResponse

**Пример:**
```typescript
export const telegramSendMessageTool: ToolConfig = {
  id: 'telegram_send_message',
  name: 'Send Message',
  params: {
    apiKey: { type: 'string', required: true, visibility: 'user-only' },
    chatId: { type: 'string', required: true, visibility: 'user-or-llm' },
    text: { type: 'string', required: true, visibility: 'user-or-llm' },
  },
  request: {
    url: (params) => `https://api.telegram.org/bot${params.apiKey}/sendMessage`,
    method: () => 'POST',
    body: (params) => ({ chat_id: params.chatId, text: params.text })
  },
  outputs: { messageId: 'string', ok: 'boolean' }
}
```

### 3. **Trigger** (Event слой)
```
apps/sim/triggers/{service}/webhook.ts
apps/sim/triggers/{service}/{event}.ts
```
- Webhook или polling trigger
- Преобразует incoming event в workflow input
- Secure verification (signature check)

**Пример:**
```typescript
export const telegramWebhookTrigger: TriggerConfig = {
  id: 'telegram_webhook',
  type: 'webhook',
  path: '/telegram/{botId}',
  verifier: (request, signature) => verifyTelegramSignature(request, signature),
  parser: (body) => ({ chatId: body.message.chat.id, text: body.message.text })
}
```

### 4. **Auth** (Credentials слой)
```
apps/sim/lib/oauth/oauth.ts           (если OAuth)
lib/api/contracts/{service}-auth.ts   (auth validation)
```
- OAuth с centralized scopes
- ApiKey credentials
- BotToken credentials

**Правила:**
- `user-only` visibility для secrets
- Centralized scopes в `getCanonicalScopesForProvider()`
- Hidden accessToken в tool params

### 5. **Meta** (Catalog слой)
```
BlockMeta (внутри block file)
integrations.json (generated)
```
- tags (CRM, Communication, Commerce, etc)
- templates (popular workflows)
- skills (suggested actions)
- docsUrl

**Пример:**
```typescript
const telegramMeta: BlockMeta = {
  tags: ['Communication', 'Bot', 'Messaging'],
  templates: [
    { name: 'Telegram Notification', category: 'Alert' },
    { name: 'Telegram Bot Command', category: 'Handler' }
  ],
  skills: [
    { title: 'Send Alert', action: 'telegram_send_message' },
    { title: 'Handle Command', action: 'telegram_webhook' }
  ]
}
```

### 6. **Docs** (Generated слой)
```
apps/docs/content/docs/en/integrations/{service}.mdx
```
- Auto-generated от DeepSeek
- `bun run scripts/generate-docs.ts`
- Примеры, параметры, outputs

---

## Матрица: Что генерировать для каждого сервиса

| Question | If Yes | Generate |
|----------|--------|----------|
| Has REST/GraphQL API? | ✓ | Tools |
| Needs UI in editor? | ✓ | Block |
| Multiple operations? | ✓ | operation dropdown |
| Has webhooks? | ✓ | Triggers |
| No webhooks but updatable? | ✓ | Polling trigger |
| Needs OAuth? | ✓ | OAuth provider + scopes |
| Needs API key? | ✓ | user-only credentials |
| Handles files? | ✓ | file-upload subBlock + internal routes |
| Has dynamic resources? | ✓ | fetchOptions/dependsOn selectors |
| Should appear in catalog? | ✓ | BlockMeta + templates + catalog docs |

---

## Pipeline для Universal Integrator v8

```
Phase 1: ANALYZE
  → provider name, auth model, base URL, webhook support

Phase 2: EXTRACT
  → ALL API endpoints (exhaustive)
  → group by resource/category

Phase 3: DESIGN
  → decide: just tools? or full block?
  → decide: webhooks, OAuth, files, dynamic selectors?
  → decide: templates, skills, catalog visibility?

Phase 4: GENERATE TOOLS
  → tool per endpoint
  → correct visibility (user-or-llm vs user-only)
  → outputs NOT guessed

Phase 5: GENERATE BLOCK
  → grouped UI (operation dropdown)
  → auth mode
  → subBlocks mapping
  → triggers.available

Phase 6: GENERATE TRIGGERS (if webhooks)
  → webhook path & verifier
  → event parser
  → register in trigger registry

Phase 7: GENERATE AUTH (if OAuth/complex)
  → OAuth provider in lib/oauth/
  → scopes definition
  → centralize scopes

Phase 8: GENERATE META
  → BlockMeta (tags, templates, skills)
  → integration catalog entry
  → docsUrl

Phase 9: REGISTER
  → add to tools/registry.ts
  → add to blocks/registry.ts
  → add to triggers/registry.ts (if triggers)
  → update integrations.json

Phase 10: GENERATE DOCS
  → bun run scripts/generate-docs.ts
  → creates apps/docs/content/docs/en/integrations/{service}.mdx

Phase 11: VALIDATE
  → all tool outputs exist
  → all block subBlocks bound to tool params
  → all triggers registered
  → no guessed schemas
  → type-check passes
```

---

## Файловая структура для нового сервиса

```
apps/sim/tools/{service}/
  ├── {action}.ts          # каждый endpoint → отдельный tool
  ├── {action}.ts
  ├── types.ts             # TypeScript интерфейсы
  └── index.ts             # export all tools

apps/sim/blocks/blocks/
  └── {service}.ts         # один block с operation dropdown

apps/sim/triggers/{service}/
  ├── webhook.ts           # webhook trigger (если нужен)
  ├── {event}.ts           # event-specific handlers
  └── utils.ts             # helper functions

apps/sim/components/
  └── icons.tsx            # добавить {Service}Icon

apps/sim/lib/oauth/        # если OAuth
  └── oauth.ts             # getCanonicalScopesForProvider()

apps/sim/app/api/tools/{service}/  # если файлы
  └── {action}/route.ts    # internal file handling

apps/docs/content/docs/en/integrations/
  └── {service}.mdx        # auto-generated
```

---

## Ключевые правила для агента

### ✓ DO

- **One tool per API operation** — 不要 group в один tool
- **Correct visibility** — user-only для secrets, user-or-llm для input, hidden для computed
- **Block operation dropdown** — для выбора action (не отдельные блоки)
- **Centralize OAuth scopes** — в getCanonicalScopesForProvider()
- **Internal file routes** — не напрямую в внешний API
- **Real outputs** — не guess, check API docs
- **BlockMeta** — tags, templates, skills для catalog
- **V2 pattern** — если улучшаешь старую интеграцию

### ✗ DON'T

- Не группируй endpoints в один tool
- Не используй random visibility
- Не создавай отдельный block для каждой операции
- Не хардкодь scopes в block, используй provider-level
- Не загружай файлы напрямую, используй internal routes
- Не guess outputs, проверяй API documentation
- Не добавляй блок без BlockMeta для catalog
- Не ломай старую интеграцию — используй V2

---

## Пример: Telegram (правильно)

```
✓ telegram_send_message.ts       (one tool)
✓ telegram_send_photo.ts         (one tool)
✓ telegram_edit_message.ts       (one tool)
✗ telegram.ts (old single monolith)  (NO)

✓ TelegramBlock { operation dropdown, maps to tools }
✗ TelegramSendMessageBlock, TelegramSendPhotoBlock (NO)

✓ telegram_webhook.ts            (webhook trigger)
✓ telegram_message_received.ts   (event parser)
✗ generic_webhook for telegram   (NO — use service-specific)

✓ BotToken auth mode
✓ telegramWebhookTrigger.verifier (signature check)
✓ BlockMeta: tags=['Communication', 'Bot', ...], templates=[...], skills=[...]
```

---

## Для агента: Decision Matrix

```typescript
interface ServiceIntegrationPlan {
  hasApiOperations: boolean           // → Tools?
  operationCount: number              // 1 → simple, 3+ → grouped block
  hasWebhooks: boolean                // → Triggers?
  webhookEvents: string[]             // → event parsers
  requiresOAuth: boolean              // → OAuth provider
  requiresApiKey: boolean             // → ApiKey auth mode
  requiresBotToken: boolean           // → BotToken auth mode
  hasFileUpload: boolean              // → file-upload subBlocks
  hasDynamicResources: boolean        // → fetchOptions/dependsOn
  shouldBeInCatalog: boolean          // → BlockMeta + templates
  existingV1Integration: string | null // → V2 pattern?
  
  // Output
  toolsToGenerate: ToolDefinition[]
  blockToGenerate: BlockDefinition
  triggersToGenerate: TriggerDefinition[]
  oauthProviderToAdd?: OAuthProvider
  fileRoutesToGenerate?: FileRoute[]
  metaToGenerate: BlockMeta
  docsToGenerate: string
}
```

---

## Как использовать

```bash
# v8 — с полной поддержкой Sim.ai архитектуры
bun run integrate 'Stripe'
bun run integrate 'Telegram'
bun run integrate 'Bitrix24'

# Результат:
# ✓ 20-50 tools (по endpoints)
# ✓ 1 block с operation dropdown
# ✓ webhook triggers (если есть)
# ✓ OAuth/auth правильно
# ✓ BlockMeta для catalog
# ✓ Registered everywhere
# ✓ Generated docs
# ✓ type-check passes
```

---

## Заключение

Sim.ai интеграция — это не одна сущность, а **6 скоординированных слоёв**. 

Универсальный агент должен:
1. Понимать эту архитектуру
2. Генерировать все 6 слоёв
3. Следовать матрице решений
4. Никогда не guess outputs или visibility
5. Всегда регистрировать всё

**Результат**: 100% готовая к production интеграция, которая работает в workflow editor, выполняется правильно, имеет docs и видна в catalog.
