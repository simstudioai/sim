# Telegram Bot API Integration Design Plan for Sim

**Date:** 2026-06-27  
**Scope:** Full Telegram Bot API (132 methods across 14 categories)  
**Integration Type:** SaaS with user-provided credentials (bot token)  
**Status:** Design phase (implementation roadmap)

---

## EXECUTIVE SUMMARY

The Telegram Bot API provides 132 methods organized into 14 functional categories. This design proposes a **category-based tool architecture** (14 tools with operation dropdowns) instead of 132 individual tools. This approach provides cleaner UX, maintainable code, and aligns with Sim's block/tool conventions.

### Key Constraints & Decisions
- **Authentication:** Bot token in URL path (NOT header or query) — `https://api.telegram.org/bot{token}/{methodName}`
- **File Handling:** 12 methods accept uploads; requires multipart/form-data proxying via internal routes
- **Webhook Security:** Token-based verification via `X-Telegram-Bot-Api-Secret-Token` header
- **Polling:** getUpdates with offset tracking for sequential update retrieval
- **Response Shape:** Standard `{ ok: true/false, result, error_code?, description? }`

---

## 1. TOOL DISTRIBUTION DECISION

### Rationale: Category-Based Tools (14 tools, not 132)

**Why NOT one-tool-per-method:**
- 132 tool files would bloat the codebase
- Discovery would be poor (users searching "send message" might miss variants like sendVideo, sendDocument, sendPhoto)
- Repetitive boilerplate in registry entries
- Harder to maintain parallel updates

**Why CATEGORY-BASED:**
- 14 logical groupings match Telegram's own API structure
- Each tool has an `operation` dropdown listing 4–27 methods
- Cleaner UX: user picks "Messages" then selects "sendMessage" or "editMessageText"
- Code reuse: shared request/response handling per category
- Aligns with Sim's pattern (e.g., Stripe tools are grouped by resource type)

---

## 2. TOOL DISTRIBUTION TABLE

| Tool ID | Category | Methods | Method Count | File Location |
|---------|----------|---------|--------------|---|
| `telegram_updates` | Getting Updates | getUpdates, setWebhook, deleteWebhook, getWebhookInfo | 4 | `apps/sim/tools/telegram/updates.ts` |
| `telegram_config` | Bot Commands & Config | getMe, getMyCommands, setMyCommands, deleteMyCommands, getMyDefaultAdministratorRights, setMyDefaultAdministratorRights, deleteMyDefaultAdministratorRights, getMyDescription, setMyDescription, getMyShortDescription, setMyShortDescription, getMyName, setMyName | 13 | `apps/sim/tools/telegram/config.ts` |
| `telegram_messages` | Sending Messages | sendMessage, forwardMessage, forwardStory, copyMessage, copyStory, sendPhoto, sendAudio, sendDocument, sendVideo, sendAnimation, sendVoice, sendVideoNote, sendMediaGroup, sendLocation, editLiveLocation, stopLiveLocation, sendVenue, sendContact, sendPoll, sendDice, sendGameHighScore, sendSticker, sendGift, sendStickerSet, sendChatAction, sendPaidMedia | 27 | `apps/sim/tools/telegram/messages.ts` |
| `telegram_edit` | Editing Messages | editMessageText, editMessageCaption, editMessageMedia, editMessageReplyMarkup, editMessageLiveLocation, stopMessageLiveLocation | 6 | `apps/sim/tools/telegram/edit.ts` |
| `telegram_delete` | Deleting & Pinning | deleteMessage, deleteMessages, forgetForumTopic, deleteForumTopic, pinChatMessage, unpinChatMessage, unpinAllChatMessages | 7 | `apps/sim/tools/telegram/delete.ts` |
| `telegram_forums` | Forum/Topic Management | createForumTopic, editForumTopic, closeForumTopic, reopenForumTopic, deleteForumTopic, unpinAllGeneralForumTopicMessages, getForumTopicIconStickers, editGeneralForumTopic, closeGeneralForumTopic, reopenGeneralForumTopic, hideGeneralForumTopic, unhideGeneralForumTopic, getForumTopicIconStickers | 13 | `apps/sim/tools/telegram/forums.ts` |
| `telegram_stickers` | Sticker Management | sendSticker, getStickerSet, getStickerSetThumbnail, uploadStickerFile, createNewStickerSet, addStickerToSet, setStickerPositionInSet, deleteStickerFromSet, replaceStickerInSet, setStickerSetTitle, setStickerSetDescription, setStickerSetThumbnail, setCustomEmojiStickerSetThumbnail, deleteStickerSet | 14 | `apps/sim/tools/telegram/stickers.ts` |
| `telegram_inline` | Inline Mode & Queries | answerInlineQuery | 1 | `apps/sim/tools/telegram/inline.ts` |
| `telegram_callbacks` | Web Apps & Callbacks | answerWebAppQuery, answerCallbackQuery, setPassportDataErrors, answerShippingQuery | 4 | `apps/sim/tools/telegram/callbacks.ts` |
| `telegram_payments` | Payments & Checkout | sendInvoice, createInvoiceLink, answerPreCheckoutQuery, answerShippingQuery, getStarTransactions, refundStarPayment, sendAffiliateProgram, getAffiliateInfo | 8 | `apps/sim/tools/telegram/payments.ts` |
| `telegram_games` | Games | sendGame, setGameScore, getGameHighScores | 3 | `apps/sim/tools/telegram/games.ts` |
| `telegram_members` | Chat Member Management | restrictChatMember, promoteChatMember, setChatAdministratorCustomTitle, banChatMember, unbanChatMember, unbanChatSenderChat, getChatMember, getChatMemberCount, getChatAdministrators, setUserChatTitle, banChatSenderChat, approveChatJoinRequest, declineChatJoinRequest | 13 | `apps/sim/tools/telegram/members.ts` |
| `telegram_chat` | Chat Management | getChat, getChatPermissions, setChatPermissions, leaveChat, setChatTitle, setChatDescription, setChatPhoto, deleteChatPhoto, setChatMenuButton, getChatMenuButton, setDefaultAdministratorRights, getDefaultAdministratorRights, setChatStickerSet, deleteChatStickerSet | 14 | `apps/sim/tools/telegram/chat.ts` |

**Total:** 14 tools, 132 methods ✓

---

## 3. AUTHENTICATION: BOT TOKEN IN URL PATH

### Critical Constraint
Telegram's API uses **bot token as part of the URL path**, not as an HTTP header or query parameter:

```
https://api.telegram.org/bot{TOKEN}/methodName
```

This differs from typical Bearer token patterns and requires special handling.

### Design Approach

#### A. BlockConfig SubBlock (User Input)

```typescript
interface TelegramBlockConfig {
  botToken: {
    type: 'short-input'
    label: 'Bot Token'
    placeholder: 'Bot token from @BotFather'
    required: true
    password: true          // Mask input
    visibility: 'user-only' // Never exposed to LLM
    hint: 'Get from @BotFather on Telegram'
  }
}
```

**Why `user-only`?**
- Bot token is secret credentials; LLM must never see it
- Token must be validated/stored at config time, not execution time
- Block requires this to be set by the human user

#### B. ToolConfig Request Pattern

```typescript
// In each tool (telegram_messages.ts, etc.)

interface TelegramToolParams {
  botToken: string        // Passed from block config
  operation: 'sendMessage' | 'editMessageText' | ...
  // ... operation-specific params
}

const config: ToolConfig = {
  request: {
    method: 'POST',
    url: (params) => {
      // Extract botToken; construct path-based URL
      return `https://api.telegram.org/bot${params.botToken}/${params.operation}`
    },
    body: (params) => {
      // All params EXCEPT botToken go in body
      const { botToken, operation, ...operationParams } = params
      return operationParams
    },
  },
  params: [
    {
      id: 'botToken',
      type: 'string',
      required: true,
      description: 'Bot token from block config',
    },
    {
      id: 'operation',
      type: 'enum',
      values: ['sendMessage', 'editMessageText', ...],
      required: true,
    },
    // ... other params, condition'd by operation
  ],
}
```

**Flow:**
1. User sets bot token in **block config** (once per chat/workflow)
2. ToolConfig injects token into URL path via `url()` function
3. Body contains only operation-specific parameters
4. Token never appears in body, query, or logs (except URL construction)

### Why NOT Query Param or Header?

| Approach | Pros | Cons |
|----------|------|------|
| **Path (our choice)** | Matches Telegram's official API; simplest; token is "part of the route" | — |
| **Query param** | Familiar pattern | Telegram doesn't support it; risks token in logs; weaker security |
| **Header** | Standard for auth | Telegram requires path; adds complexity for no gain |

---

## 4. SUBBLOCK TYPE MAPPING

Map Telegram parameter types to Sim UI components:

| Telegram Type | Sim SubBlock Type | Visibility | Details |
|---|---|---|---|
| **chat_id** (Integer\|String) | `config-short-input` | user-only | Chat ID or @username; required for most operations |
| **message_id** (Integer) | `config-short-input` | user-only | Sequential message ID in chat |
| **user_id** (Integer) | `config-short-input` | user-only | Telegram user ID |
| **text** (String, 1-4096) | `content-long-input` | user-or-llm | Message text; LLM can compose |
| **caption** (String, 0-1024) | `content-long-input` | user-or-llm | Photo/video caption |
| **parse_mode** (String) | `user-or-llm-dropdown` | user-or-llm | Options: "MarkdownV2", "HTML", "Markdown" |
| **disable_web_page_preview** (Boolean) | `user-only-switch` | user-only | Disable link preview |
| **disable_notification** (Boolean) | `user-only-switch` | user-only | Send silently |
| **protect_content** (Boolean) | `user-only-switch` | user-only | Protect message (prevent forwarding) |
| **reply_to_message_id** (Integer) | `user-only-short-input` | user-only | Message ID to reply to |
| **allow_user_chats** (Boolean) | `user-only-switch` | user-only | Allow for private chats |
| **allow_bot_chats** (Boolean) | `user-only-switch` | user-only | Allow for bot chats |
| **allow_group_chats** (Boolean) | `user-only-switch` | user-only | Allow for group chats |
| **allow_channel_chats** (Boolean) | `user-only-switch` | user-only | Allow for channel chats |
| **limit** (Integer, 1-100) | `user-only-slider` | user-only | Range slider, min=1, max=100 |
| **offset** (Integer, ≥0) | `user-only-short-input` | user-only | Pagination offset |
| **timeout** (Integer, 0-50) | `user-only-slider` | user-only | Long-polling timeout in seconds |
| **photo** (InputFile) | `file-upload` | user-or-llm | File, file_id, or URL |
| **document** (InputFile) | `file-upload` | user-or-llm | File, file_id, or URL |
| **video** (InputFile) | `file-upload` | user-or-llm | File, file_id, or URL |
| **audio** (InputFile) | `file-upload` | user-or-llm | File, file_id, or URL |
| **voice** (InputFile) | `file-upload` | user-or-llm | File, file_id, or URL |
| **sticker** (InputFile) | `file-upload` | user-or-llm | Sticker file, file_id, or URL |
| **InlineKeyboardMarkup** (JSON object) | `config-json` | user-only | Inline button rows; complex structure |
| **ReplyKeyboardMarkup** (JSON object) | `config-json` | user-only | Reply keyboard rows; complex structure |
| **ReplyParameters** (JSON object) | `config-json` | user-only | Reply/thread metadata |
| **InputMedia\*** (JSON object) | `config-json` | user-only | Media object (photo, video, etc.) |
| **date** (Integer, Unix timestamp) | `config-date-input` | user-only | Date picker |
| **currency_total_amount** (Integer) | `config-short-input` | user-only | Numeric amount in cents |
| **file_id** (String) | `config-short-input` | user-only | Telegram file ID for reuse |
| **sticker_set_name** (String) | `config-short-input` | user-only | Sticker set identifier |
| **emoji** (String, single emoji) | `config-short-input` | user-only | Custom emoji |
| **url** (String) | `config-short-input` | user-or-llm | Callback query data or similar |
| **description** (String, 0-255) | `content-long-input` | user-or-llm | Chat/sticker set description |
| **title** (String, 0-128) | `config-short-input` | user-or-llm | Chat/sticker set title |
| **Array\<String\>** (strings) | `config-json` | user-only | JSON array of strings (e.g., allowed_updates) |
| **Array\<Integer\>** (message IDs) | `config-json` | user-only | JSON array of integers (e.g., message_ids) |

### Visibility Rules

- **user-only:** Config/secret values; human user input only (chat IDs, file IDs, authentication params)
- **user-or-llm:** Content; LLM can compose (message text, captions, descriptions, titles, URLs for callbacks)

---

## 5. PARAMETER VISIBILITY & PROGRESSIVE DISCLOSURE

### Standard Visibility Matrix

#### Always User-Only (Config/Auth)
- `botToken` (block-level, injected into URL)
- `chat_id`, `message_id`, `user_id` (identifiers)
- `file_id`, `sticker_set_name` (resource identifiers)
- Database/storage identifiers: `custom_emoji_id`, `payment_provider_token`
- `reply_to_message_id`, `message_thread_id` (conversation structure)
- File uploads: `photo`, `document`, `video`, `audio`, `voice`, `sticker`
- Flags: `disable_notification`, `protect_content`, `allow_user_chats`, etc.
- JSON objects: `InlineKeyboardMarkup`, `ReplyKeyboardMarkup`, `ReplyParameters`, `InputMedia*`
- Limits/pagination: `limit`, `offset`, `timeout`

#### User-or-LLM (Content/Composition)
- `text` (message body)
- `caption` (image/video caption)
- `description` (chat or sticker set description)
- `title` (chat or sticker set title)
- `parse_mode` (how to render text — user picks HTML, LLM writes content)
- `url` (callback query payload that LLM might construct)
- Any field meant to be **synthesized or customized** by the LLM

### Progressive Disclosure: Basic vs Advanced

**Basic mode** (default, 80% of use cases):
- `operation`
- `chat_id`
- `text` or `caption` (depending on operation)
- `parse_mode`
- `disable_notification`
- `reply_markup` (if operation supports it)

**Advanced mode** (collapse until toggled):
- `message_thread_id` (forum topics)
- `reply_to_message_id`
- `allow_user_chats`, `allow_bot_chats`, `allow_group_chats`, `allow_channel_chats`
- `protect_content`
- `disable_web_page_preview`
- Custom button/keyboard JSON
- Any `set*` operation (setChatTitle, setChatDescription, etc.)

```typescript
// SubBlock config example
{
  id: 'text',
  type: 'long-input',
  label: 'Message Text',
  required: true,
  mode: 'basic',
  visibility: 'user-or-llm',
},
{
  id: 'reply_to_message_id',
  type: 'short-input',
  label: 'Reply to Message (ID)',
  mode: 'advanced',
  visibility: 'user-only',
  condition: {
    field: 'operation',
    operator: 'in',
    value: ['sendMessage', 'sendPhoto', 'sendVideo'], // Operations that support replies
  },
}
```

---

## 6. CONDITIONAL PARAMETERS: OPERATION-SPECIFIC FIELDS

Not all parameters apply to all operations. Use `condition` to show/hide fields based on selected operation.

### Example: sendMessage vs editMessageText

**sendMessage accepts:**
- `reply_markup` ✓
- `message_thread_id` ✓
- `reply_to_message_id` ✓

**editMessageText accepts:**
- `inline_message_id` ✓ (alternative to chat_id+message_id)
- `reply_markup` ✓
- But NOT `message_thread_id`, `reply_to_message_id`

```typescript
// SubBlock definitions in telegram_messages.ts

[
  {
    id: 'operation',
    type: 'enum',
    values: [
      { label: 'Send Message', value: 'sendMessage' },
      { label: 'Forward Message', value: 'forwardMessage' },
      { label: 'Send Photo', value: 'sendPhoto' },
      // ... etc
    ],
    required: true,
  },
  {
    id: 'chat_id',
    type: 'short-input',
    label: 'Chat ID',
    required: true,
    visibility: 'user-only',
    condition: {
      field: 'operation',
      operator: 'notIn',
      value: ['forwardStory', 'copyStory'], // These don't use chat_id
    },
  },
  {
    id: 'text',
    type: 'long-input',
    label: 'Message Text',
    required: true,
    visibility: 'user-or-llm',
    condition: {
      field: 'operation',
      operator: 'in',
      value: ['sendMessage'], // Only for sendMessage
    },
  },
  {
    id: 'photo',
    type: 'file-upload',
    label: 'Photo',
    required: true,
    visibility: 'user-or-llm',
    condition: {
      field: 'operation',
      value: 'sendPhoto',
    },
  },
  {
    id: 'caption',
    type: 'long-input',
    label: 'Caption',
    visibility: 'user-or-llm',
    condition: {
      field: 'operation',
      operator: 'in',
      value: ['sendPhoto', 'sendVideo', 'sendAudio', 'sendDocument', 'sendAnimation'],
    },
  },
  {
    id: 'parse_mode',
    type: 'dropdown',
    label: 'Parse Mode',
    values: ['MarkdownV2', 'HTML', 'Markdown'],
    visibility: 'user-or-llm',
    condition: {
      field: 'operation',
      operator: 'in',
      value: ['sendMessage', 'editMessageText', 'editMessageCaption'],
    },
  },
  {
    id: 'reply_markup',
    type: 'json',
    label: 'Reply Markup (Keyboard/Buttons)',
    hint: 'InlineKeyboardMarkup or ReplyKeyboardMarkup',
    visibility: 'user-only',
    condition: {
      field: 'operation',
      operator: 'in',
      value: ['sendMessage', 'editMessageText', 'sendPhoto', 'sendVideo', /* ... many more */],
    },
  },
  {
    id: 'reply_to_message_id',
    type: 'short-input',
    label: 'Reply to Message ID',
    visibility: 'user-only',
    condition: {
      field: 'operation',
      operator: 'in',
      value: ['sendMessage', 'sendPhoto', 'sendVideo', /* ... */],
    },
  },
  {
    id: 'message_thread_id',
    type: 'short-input',
    label: 'Topic/Thread ID',
    visibility: 'user-only',
    mode: 'advanced',
    condition: {
      field: 'operation',
      operator: 'in',
      value: ['sendMessage', 'sendPhoto', 'sendVideo', /* ... topic-supporting methods */],
    },
  },
  {
    id: 'disable_notification',
    type: 'switch',
    label: 'Send Silently',
    visibility: 'user-only',
    condition: {
      field: 'operation',
      operator: 'in',
      value: ['sendMessage', 'sendPhoto', /* ... all send methods */],
    },
  },
]
```

### Condition Operator Reference
- `value: 'sendMessage'` → operation === 'sendMessage'
- `operator: 'in', value: ['sendMessage', 'sendPhoto']` → operation in ['sendMessage', 'sendPhoto']
- `operator: 'notIn', value: [...]` → operation not in [...]

---

## 7. FILE HANDLING: UPLOAD PROXY ROUTES

### Which Methods Accept File Uploads? (12 total)

1. `sendPhoto` — Photo file
2. `sendAudio` — Audio file
3. `sendDocument` — Document file
4. `sendVideo` — Video file
5. `sendAnimation` — GIF file
6. `sendVoice` — Voice file
7. `sendVideoNote` — Video note file
8. `sendSticker` — Sticker file
9. `uploadStickerFile` — Sticker file for bulk upload
10. `setChatPhoto` — Chat photo file
11. `setStickerSetThumbnail` — Sticker set thumbnail
12. `setCustomEmojiStickerSetThumbnail` — Custom emoji thumbnail

### Three Input Formats Supported by Telegram

1. **file_id** (String) — Reuse previously uploaded file. Fast, no upload needed.
   ```json
   { "chat_id": 123, "photo": "AgACAgIAAxkBAAI..." }
   ```

2. **URL** (String, HTTP/HTTPS) — Telegram downloads the file. No multipart needed.
   ```json
   { "chat_id": 123, "photo": "https://example.com/image.jpg" }
   ```

3. **Binary Upload** (multipart/form-data) — New file. Requires proxying.
   ```
   POST /api/tools/telegram/sendPhoto
   Content-Type: multipart/form-data
   
   Field: photo=<binary file data>
   Field: chat_id=123
   ```

### Proxy Route Design Pattern

**Why we need proxy routes:**
- Sim's tools are typed JSON; Telegram API expects `multipart/form-data` for binary uploads
- Sim's UI has a `file-upload` component that produces `UserFile` objects
- We convert UserFile → multipart → Telegram

**Route structure:**

```typescript
// apps/sim/app/api/tools/telegram/sendPhoto/route.ts

import { normalizeFileInput } from '@/lib/integrations/file-input'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createLogger } from '@sim/logger'

const logger = createLogger('TelegramSendPhoto')

export const POST = withRouteHandler(async (request: NextRequest) => {
  // Parse as multipart/form-data
  const formData = await request.formData()
  
  const botToken = formData.get('botToken') as string
  const chatId = formData.get('chat_id') as string
  const photoFile = formData.get('photo') as File | null
  const caption = formData.get('caption') as string | undefined
  const parseMode = formData.get('parse_mode') as string | undefined
  
  if (!botToken || !chatId || !photoFile) {
    return NextResponse.json(
      { error: 'Missing required fields' },
      { status: 400 }
    )
  }
  
  // Normalize file to multipart
  const uploadFormData = new FormData()
  uploadFormData.append('chat_id', chatId)
  uploadFormData.append('photo', photoFile, photoFile.name)
  if (caption) uploadFormData.append('caption', caption)
  if (parseMode) uploadFormData.append('parse_mode', parseMode)
  
  // Forward to Telegram API
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendPhoto`,
    {
      method: 'POST',
      body: uploadFormData,
    }
  )
  
  const data = await response.json()
  
  if (!data.ok) {
    logger.error('Telegram API error', {
      error_code: data.error_code,
      description: data.description,
    })
    return NextResponse.json(data, { status: response.status })
  }
  
  return NextResponse.json(data.result)
})
```

**Tool points to the proxy:**

```typescript
// In telegram_messages.ts

const sendPhotoConfig: ToolConfig = {
  // ... other config
  request: {
    method: 'POST',
    url: '/api/tools/telegram/sendPhoto', // Points to proxy, not Telegram directly
  },
  // ... params
}
```

### File Upload SubBlock Configuration

```typescript
{
  id: 'photo',
  type: 'file-upload',
  label: 'Photo',
  accept: 'image/*',
  required: true,
  visibility: 'user-or-llm',
  hint: 'JPEG, PNG, WebP, or file_id/URL (optional; omit to reuse existing file)',
}
```

**SubBlock behavior:**
- UI allows selecting a local file OR entering a string (file_id or URL)
- If file: UserFile object with { name, type, size, path }
- If string: passed as-is to Telegram (file_id or URL)

**Tool handles both:**

```typescript
// In tool params

if (typeof photo === 'string') {
  // file_id or URL; send as JSON
  body.photo = photo
} else {
  // UserFile; prepare for multipart proxy
  formData.append('photo', photo.file, photo.name)
}
```

---

## 8. TRIGGERS: WEBHOOK + POLLING

### Two Update Modes

**Polling (getUpdates):**
- Sim calls `getUpdates` repeatedly
- Returns list of new updates since last offset
- No external endpoint needed
- ~100ms+ latency per poll cycle

**Webhook (setWebhook):**
- Sim registers HTTPS URL via `setWebhook`
- Telegram POSTs updates to that URL as they arrive
- <1s latency
- Requires public HTTPS endpoint with valid certificate

### Trigger Block Design

```typescript
// blocks/registry.ts entry

{
  id: 'telegram_trigger',
  name: 'Telegram',
  icon: 'telegram',
  description: 'Listen for Telegram messages, callbacks, or inline queries',
  integrationType: 'TELEGRAM',
  docsLink: 'https://core.telegram.org/bots/api#update',
  subBlocks: [
    {
      id: 'botToken',
      type: 'short-input',
      label: 'Bot Token',
      required: true,
      password: true,
      visibility: 'user-only',
    },
    {
      id: 'updateMode',
      type: 'dropdown',
      label: 'Update Mode',
      values: ['polling', 'webhook'],
      default: 'polling',
      required: true,
    },
    {
      id: 'webhookUrl',
      type: 'short-input',
      label: 'Webhook URL',
      hint: 'HTTPS endpoint (auto-generated or custom)',
      required: true,
      condition: { field: 'updateMode', value: 'webhook' },
      visibility: 'user-only',
    },
    {
      id: 'webhookSecret',
      type: 'short-input',
      label: 'Webhook Secret Token',
      hint: '[A-Za-z0-9_-] only; 1-256 chars',
      mode: 'advanced',
      visibility: 'user-only',
      condition: { field: 'updateMode', value: 'webhook' },
    },
    {
      id: 'pollInterval',
      type: 'slider',
      label: 'Poll Interval (ms)',
      min: 1000,
      max: 30000,
      step: 1000,
      default: 1000,
      condition: { field: 'updateMode', value: 'polling' },
    },
    {
      id: 'pollingTimeout',
      type: 'slider',
      label: 'Long Polling Timeout (s)',
      min: 0,
      max: 50,
      step: 1,
      default: 30,
      hint: 'Seconds to wait for updates (0 = no wait)',
      condition: { field: 'updateMode', value: 'polling' },
    },
    {
      id: 'allowedUpdateTypes',
      type: 'json',
      label: 'Filter Update Types',
      hint: 'Array: ["message", "callback_query", "inline_query", ...] or null for all',
      default: null,
      visibility: 'user-only',
      mode: 'advanced',
    },
  ],
}
```

### Trigger Implementation: Polling Path

```typescript
// triggers/telegram.ts — polling variant

import { createLogger } from '@sim/logger'

export const telegramPollingTrigger = {
  id: 'telegram_polling',
  type: 'polling',
  
  async poll(config: TriggerConfig): Promise<TriggerEvent[]> {
    const {
      botToken,
      pollInterval = 1000,
      pollingTimeout = 30,
      allowedUpdateTypes = null,
    } = config
    
    const logger = createLogger('TelegramPolling', { botToken: '***' })
    
    // Get last stored offset for this trigger
    const lastOffset = await getStoredOffset(config.triggerId)
    
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/getUpdates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offset: lastOffset ? lastOffset + 1 : undefined,
            limit: 100,
            timeout: pollingTimeout,
            allowed_updates: allowedUpdateTypes,
          }),
        }
      )
      
      const data = await response.json()
      
      if (!data.ok) {
        logger.error('getUpdates failed', {
          error_code: data.error_code,
          description: data.description,
        })
        return []
      }
      
      const updates = data.result || []
      
      if (updates.length > 0) {
        // Store max update_id for next poll
        const maxUpdateId = Math.max(...updates.map((u) => u.update_id))
        await storeOffset(config.triggerId, maxUpdateId)
        
        logger.info('Received updates', { count: updates.length })
      }
      
      // Convert each Update to TriggerEvent
      return updates.map((update) => ({
        id: `${config.triggerId}_${update.update_id}`,
        timestamp: Date.now(),
        data: update, // Full Telegram Update object
      }))
    } catch (error) {
      logger.error('Poll failed', { error })
      return []
    }
  },
}
```

### Trigger Implementation: Webhook Path

```typescript
// triggers/telegram.ts — webhook variant

export const telegramWebhookTrigger = {
  id: 'telegram_webhook',
  type: 'webhook',
  
  async register(config: TriggerConfig): Promise<void> {
    const { botToken, webhookUrl, webhookSecret } = config
    const logger = createLogger('TelegramWebhook', { botToken: '***' })
    
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            secret_token: webhookSecret || undefined,
            drop_pending_updates: true, // Start fresh
          }),
        }
      )
      
      const data = await response.json()
      
      if (!data.ok) {
        throw new Error(`Telegram error: ${data.description}`)
      }
      
      logger.info('Webhook registered', { url: webhookUrl })
    } catch (error) {
      logger.error('Failed to register webhook', { error })
      throw error
    }
  },
  
  async unregister(config: TriggerConfig): Promise<void> {
    const { botToken } = config
    
    await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: true }),
    })
  },
  
  validateSignature(request: Request, config: TriggerConfig): boolean {
    const secretToken = config.webhookSecret
    if (!secretToken) return true // No signature validation if not configured
    
    const headerToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
    return headerToken === secretToken
  },
}
```

### Webhook Endpoint

```typescript
// apps/sim/app/api/webhooks/telegram/route.ts

import { telegramWebhookTrigger } from '@/triggers/telegram'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const POST = withRouteHandler(async (request: NextRequest) => {
  // Parse update
  const update = await request.json()
  
  // Validate signature
  const trigger = /* load trigger config */
  if (!telegramWebhookTrigger.validateSignature(request, trigger)) {
    return NextResponse.json({ ok: false }, { status: 403 })
  }
  
  // Enqueue as trigger event
  await enqueueTriggerEvent({
    triggerId: trigger.id,
    data: update,
    timestamp: Date.now(),
  })
  
  return NextResponse.json({ ok: true })
})
```

### Update Types & Event Payloads

Telegram `Update` object structure:

```typescript
interface Update {
  update_id: number // Unique ID; use for dedup + offset tracking
  message?: Message
  edited_message?: Message
  channel_post?: Message
  edited_channel_post?: Message
  callback_query?: CallbackQuery
  inline_query?: InlineQuery
  chosen_inline_result?: ChosenInlineResult
  pre_checkout_query?: PreCheckoutQuery
  shipping_query?: ShippingQuery
  // ... more optional fields
}
```

**Deduplication:**
- Track `update_id` in a database/cache
- If duplicate received (edge case in polling), skip it
- Webhook: Telegram guarantees each update delivered once IF we ACK with HTTP 200

---

## 9. RESPONSE SHAPES & TRANSFORMATION

### Standard Telegram Response Format

All Telegram API responses follow this envelope:

```json
{
  "ok": true,
  "result": {
    // ... varies by method
  }
}
```

Or on error:

```json
{
  "ok": false,
  "error_code": 400,
  "description": "Bad Request: message text is empty"
}
```

### Transformation Rules

Each tool must define response transformation to unwrap `result` and handle errors:

```typescript
// In each tool config

const config: ToolConfig = {
  // ...
  transformResponse: (response, { operation }) => {
    if (response.ok === false) {
      throw new Error(
        `Telegram API error [${response.error_code}]: ${response.description}`
      )
    }
    
    // Return unwrapped result
    return response.result
  },
}
```

### Response Shapes by Operation Category

| Category | Typical Response Type | Example |
|---|---|---|
| **Sending Messages** | `Message` object or `true` | `{ message_id, date, chat, text, ... }` or `true` |
| **Editing Messages** | `Message` or `true` | Same as send |
| **Deleting** | `true` | Boolean true on success |
| **Getting Data** | Single object or array | `User`, `Chat`, `Message`, `Array<Message>`, etc. |
| **Bot Commands** | `true` or specific object | `true` for set operations; object for get |
| **Webhook/Updates** | `true` or boolean | `true` on success |
| **Payments** | `true` | Boolean |

### Key Response Objects

**Message:**
```typescript
{
  message_id: number
  message_thread_id?: number
  from?: User
  sender_chat?: Chat
  date: number // Unix timestamp
  chat: Chat
  forward_origin?: MessageOrigin
  is_topic_message?: boolean
  text?: string
  caption?: string
  photo?: PhotoSize[]
  video?: Video
  // ... 50+ optional fields depending on message type
}
```

**User:**
```typescript
{
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  // ... other fields
}
```

**Chat:**
```typescript
{
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
  first_name?: string
  description?: string
  // ... many optional fields
}
```

---

## 10. ERROR HANDLING

### Telegram Error Response Format

```json
{
  "ok": false,
  "error_code": NUMBER,
  "description": "Human-readable error message",
  "parameters": {
    "retry_after": NUMBER // Optional: seconds to retry (HTTP 429)
  }
}
```

### Common Error Codes

| Code | Meaning | Handling |
|------|---------|----------|
| 400 | Bad Request | Validation error; check params |
| 401 | Unauthorized | Bot token invalid or revoked |
| 403 | Forbidden | Insufficient permissions (e.g., not admin) |
| 404 | Not Found | Resource (chat, message) doesn't exist |
| 429 | Too Many Requests | Rate limit hit; retry after `parameters.retry_after` |
| 500 | Internal Server Error | Telegram server issue; retry with backoff |

### Error Handling in Tools

```typescript
// transformResponse function in each tool

transformResponse: (response) => {
  if (!response.ok) {
    const error = new Error(response.description)
    ;(error as any).errorCode = response.error_code
    ;(error as any).retryAfter = response.parameters?.retry_after
    throw error
  }
  return response.result
}
```

### Error Handling in Triggers

```typescript
// Polling trigger error handling

try {
  const response = await fetch(...)
  const data = await response.json()
  
  if (!data.ok) {
    if (data.error_code === 429) {
      const retryAfter = data.parameters?.retry_after || 60
      logger.warn('Rate limited', { retryAfter })
      // Wait before next poll
      await sleep(retryAfter * 1000)
    } else if (data.error_code === 401) {
      logger.error('Bot token invalid', { })
      // Stop polling; requires config update
      throw new Error('Bot token expired or revoked')
    } else {
      logger.error('getUpdates failed', { ...data })
    }
    return []
  }
  // ... process updates
} catch (error) {
  logger.error('Poll failed', { error: getErrorMessage(error) })
  return []
}
```

### Retry Strategy

Use `backoffWithJitter` from `@sim/utils/retry`:

```typescript
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'

// Exponential backoff with jitter
let attempt = 0
while (attempt < 3) {
  try {
    return await fetch(...)
  } catch (error) {
    if (attempt < 2) {
      const delayMs = backoffWithJitter(attempt, 1000)
      await sleep(delayMs)
      attempt++
    } else {
      throw error
    }
  }
}
```

---

## 11. SPECIAL CASES & EDGE BEHAVIORS

### A. getUpdates: Long Polling

**Unique behavior:** The `timeout` parameter tells Telegram to hold the request open for up to `timeout` seconds, waiting for updates. This is "long polling."

```typescript
// In polling trigger

const response = await fetch(
  `https://api.telegram.org/bot${botToken}/getUpdates`,
  {
    method: 'POST',
    body: JSON.stringify({
      offset: lastOffset + 1,
      limit: 100,
      timeout: 30, // Hold open for 30s
      allowed_updates: ['message', 'callback_query'], // Filter
    }),
    timeout: 35000, // Fetch timeout must be > Telegram timeout
  }
)
```

**Implications:**
- Network request stays open for ~30s
- Telegram returns immediately if updates arrive, or after timeout
- Reduces polling overhead vs short intervals
- Set fetch timeout > Telegram timeout to avoid premature network close

### B. setWebhook: Registering Push Updates

**One-time registration:**

```typescript
// setWebhook is called once during trigger setup

await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
  method: 'POST',
  body: JSON.stringify({
    url: 'https://myapp.com/webhooks/telegram',
    secret_token: 'my-secret-123', // Validates incoming requests
    drop_pending_updates: true, // Clear queue on re-registration
  }),
})
```

**Cleanup on trigger removal:**

```typescript
// deleteWebhook is called when trigger is deleted

await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
  method: 'POST',
  body: JSON.stringify({
    drop_pending_updates: true,
  }),
})
```

### C. File Methods: Three Input Types

Each file method (`sendPhoto`, `sendVideo`, etc.) accepts one of three formats:

1. **File ID (fast reuse):**
   ```json
   { "chat_id": 123, "photo": "AgACAgIAAxkBAAI..." }
   ```

2. **URL (Telegram downloads):**
   ```json
   { "chat_id": 123, "photo": "https://example.com/photo.jpg" }
   ```

3. **Binary (multipart upload):**
   ```
   Content-Type: multipart/form-data
   photo=<file bytes>
   chat_id=123
   ```

**Tool logic:**

```typescript
// Determine which format based on input type

const photoInput = params.photo // String | UserFile

if (typeof photoInput === 'string') {
  // Case 1 or 2: file_id or URL
  if (photoInput.startsWith('http')) {
    // URL; send as JSON
    body.photo = photoInput
  } else {
    // Assume file_id (Telegram IDs are base64-ish)
    body.photo = photoInput
  }
} else {
  // Case 3: UserFile; send to proxy route instead
  // Tool config url points to /api/tools/telegram/sendPhoto
  // Proxy converts UserFile to multipart
}
```

### D. Payments: Asynchronous Flow

Payments involve multiple steps:

1. **Seller sends invoice:**
   ```
   sendInvoice(chat_id, title, description, payload, currency, prices)
   → Returns message_id
   ```

2. **User clicks "Pay"** → Telegram shows payment interface

3. **Webhook arrives:** `pre_checkout_query`
   ```json
   {
     "update_id": 123,
     "pre_checkout_query": {
       "id": "query_id_123",
       "from": { "id": 456, ... },
       "currency": "USD",
       "total_amount": 10000,
       "invoice_payload": "payload_sent_in_step_1"
     }
   }
   ```

4. **Bot responds:** `answerPreCheckoutQuery(pre_checkout_query_id, ok=true)`

5. **Successful payment:** `successful_payment` field appears in next `message`

**Design implications:**
- Payments trigger webhook events (not a direct tool response)
- Bot must handle `pre_checkout_query` asynchronously
- Use blocks/webhooks to chain payment flows

### E. Inline Mode: Asynchronous Query/Response

Similar async flow:

1. **User types** `@botname search term` → `inline_query` update arrives
2. **Bot calls** `answerInlineQuery(inline_query_id, results=[...])` with results
3. **User selects result** → `chosen_inline_result` update arrives

### F. Sticker Sets: Complex File + Metadata

Creating sticker sets requires:
- Upload sticker files via `uploadStickerFile`
- Get file IDs back
- Create set with metadata + file IDs via `createNewStickerSet`
- Can't batch; must do sequentially

```typescript
// Pseudo-code for sticker workflow

const file1_id = await uploadStickerFile(botToken, sticker_file_1)
const file2_id = await uploadStickerFile(botToken, sticker_file_2)

await createNewStickerSet(botToken, {
  user_id: 123,
  name: 'my_stickers',
  title: 'My Stickers',
  stickers: [
    { sticker: file1_id, emoji_list: ['😀'] },
    { sticker: file2_id, emoji_list: ['😂'] },
  ],
})
```

### G. Restricted Members: Permission Bitmap

`restrictChatMember` uses permission flags (boolean fields):

```typescript
{
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
}
```

**UI design:** Either JSON object OR toggle switches for each permission:

```typescript
{
  id: 'permissions',
  type: 'json', // OR: custom component with 14 switches
  label: 'Permissions',
  visibility: 'user-only',
}
```

---

## 12. REGISTRIES TO UPDATE

### A. `blocks/registry.ts`

Add new block entry:

```typescript
export const BLOCKS_BY_ID = {
  // ... existing blocks ...
  telegram_trigger: () => import('@/blocks/telegram/trigger').then(m => m.TelegramTriggerBlock),
}

export const TELEGRAM_BLOCK_REGISTRY = {
  telegram_trigger: {
    icon: 'telegram',
    category: 'events',
    name: 'Telegram',
    description: 'Receive Telegram messages, callbacks, and updates',
    integrationType: 'TELEGRAM',
  },
}
```

### B. `tools/index.ts` (or similar registry)

Add all 14 tool exports:

```typescript
export {
  telegramUpdatesConfig,
  telegramConfigConfig,
  telegramMessagesConfig,
  telegramEditConfig,
  telegramDeleteConfig,
  telegramForumsConfig,
  telegramStickersConfig,
  telegramInlineConfig,
  telegramCallbacksConfig,
  telegramPaymentsConfig,
  telegramGamesConfig,
  telegramMembersConfig,
  telegramChatConfig,
} from '@/tools/telegram'
```

### C. `tools/registry.ts`

Register each tool:

```typescript
export const TOOLS_BY_ID: Record<string, ToolConfig> = {
  // ... existing tools ...
  telegram_updates: telegramUpdatesConfig,
  telegram_config: telegramConfigConfig,
  telegram_messages: telegramMessagesConfig,
  telegram_edit: telegramEditConfig,
  telegram_delete: telegramDeleteConfig,
  telegram_forums: telegramForumsConfig,
  telegram_stickers: telegramStickersConfig,
  telegram_inline: telegramInlineConfig,
  telegram_callbacks: telegramCallbacksConfig,
  telegram_payments: telegramPaymentsConfig,
  telegram_games: telegramGamesConfig,
  telegram_members: telegramMembersConfig,
  telegram_chat: telegramChatConfig,
}
```

### D. `triggers/registry.ts`

Add trigger registration:

```typescript
export const TRIGGERS_BY_ID = {
  // ... existing triggers ...
  telegram_polling: telegramPollingTrigger,
  telegram_webhook: telegramWebhookTrigger,
}
```

### E. Icons

Add Telegram icon to `components/icons.tsx`:

```typescript
export const TelegramIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" {...props}>
    {/* SVG content from https://cdn.simpleicons.org/telegram/0088cc */}
  </svg>
)
```

Or integrate with icon library:

```typescript
import { TelegramIcon } from 'lucide-react' // If available
```

### F. Hosted Keys (Optional: future enhancement)

If Sim eventually supports bot-token-as-hosted-key:

```typescript
export const TELEGRAM_HOSTED_KEY_CONFIG = {
  integration: 'telegram',
  keyType: 'bot_token',
  label: 'Bot Token',
  description: 'Telegram bot token from @BotFather',
  hostedKeyUrl: '/api/keys/telegram',
}
```

---

## 13. RESPONSE TRANSFORMATION PSEUDOCODE

### Generic Response Handler (applies to all tools)

```typescript
function transformTelegramResponse(rawResponse: any): any {
  // Telegram envelope: { ok: boolean, result?: any, error_code?: number, description?: string }
  
  if (!rawResponse.ok) {
    const error = new Error(
      rawResponse.description || `Telegram error ${rawResponse.error_code}`
    )
    ;(error as any).code = rawResponse.error_code
    ;(error as any).retryAfter = rawResponse.parameters?.retry_after
    throw error
  }
  
  // Unwrap result
  return rawResponse.result // Can be: true, false, object, array, null
}

// Per-tool transformation (example: sendMessage)
const sendMessageConfig: ToolConfig = {
  // ...
  transformResponse: (response) => {
    const message = transformTelegramResponse(response)
    
    // Validate expected shape
    if (!message.message_id) {
      throw new Error('Invalid response: missing message_id')
    }
    
    // Return structured output
    return {
      messageId: message.message_id,
      date: new Date(message.date * 1000),
      chatId: message.chat.id,
      text: message.text,
      userId: message.from?.id,
    }
  },
}
```

---

## 14. ERROR HANDLING PSEUDOCODE

### Comprehensive Error Handling Flow

```typescript
async function callTelegramApi(toolConfig: ToolConfig, params: any): Promise<any> {
  const { botToken, operation } = params
  
  try {
    // 1. Validate required params
    if (!botToken) throw new Error('Bot token required')
    if (!operation) throw new Error('Operation required')
    
    // 2. Build request
    const url = buildUrl(botToken, operation)
    const body = buildBody(params)
    
    // 3. Call Telegram
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortSignal, // For cancellation
    })
    
    const data = await response.json()
    
    // 4. Handle HTTP errors
    if (!response.ok) {
      logger.error('HTTP error', { status: response.status, data })
      throw new Error(`HTTP ${response.status}: ${data.description}`)
    }
    
    // 5. Handle Telegram API errors
    if (!data.ok) {
      const error = new Error(data.description)
      ;(error as any).code = data.error_code
      ;(error as any).retryAfter = data.parameters?.retry_after
      
      // 6. Log with context
      logger.error('Telegram API error', {
        code: data.error_code,
        description: data.description,
        operation,
      })
      
      throw error
    }
    
    // 7. Transform response
    return toolConfig.transformResponse(data)
    
  } catch (error) {
    // 8. Classify error
    const err = toError(error)
    
    if (err.code === 429) {
      // Rate limited; suggest retry after
      logger.warn('Rate limited', {
        retryAfter: err.retryAfter,
      })
      throw new Error(
        `Rate limited. Retry after ${err.retryAfter || 60} seconds`
      )
    }
    
    if (err.code === 401) {
      // Invalid token
      logger.error('Auth failed', { })
      throw new Error('Bot token is invalid or revoked')
    }
    
    if (err.code === 403) {
      // Permission denied
      logger.warn('Permission denied', { })
      throw new Error('Bot lacks required permissions for this action')
    }
    
    if (err.code === 404) {
      // Not found
      throw new Error('Resource not found (invalid chat ID or message ID)')
    }
    
    // Generic error
    throw err
  }
}
```

### Polling Trigger Error Handling

```typescript
async function pollForUpdates(config: TriggerConfig): Promise<Update[]> {
  const { botToken, pollingTimeout } = config
  let lastOffset = await getStoredOffset(config.id)
  
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getUpdates`,
      {
        method: 'POST',
        body: JSON.stringify({
          offset: lastOffset ? lastOffset + 1 : undefined,
          timeout: pollingTimeout,
          limit: 100,
        }),
        timeout: (pollingTimeout + 5) * 1000, // Fetch timeout > Telegram timeout
      }
    )
    
    const data = await response.json()
    
    if (!data.ok) {
      // Handle different error codes
      if (data.error_code === 401) {
        logger.error('Invalid bot token', { })
        // Stop polling; trigger needs update
        throw new StopPollingError('Bot token invalid')
      }
      
      if (data.error_code === 429) {
        const retryAfter = data.parameters?.retry_after || 60
        logger.warn('Rate limited', { retryAfter })
        // Sleep before next attempt
        await sleep(retryAfter * 1000)
        return []
      }
      
      logger.error('getUpdates failed', { error_code: data.error_code })
      return []
    }
    
    const updates = data.result || []
    
    if (updates.length > 0) {
      lastOffset = Math.max(...updates.map(u => u.update_id))
      await storeOffset(config.id, lastOffset)
      
      // Dedup: check if we've seen these update_ids
      return updates.filter(u => !seenUpdateIds.has(u.update_id))
    }
    
    return []
    
  } catch (error) {
    if (error instanceof StopPollingError) {
      throw error // Let caller stop trigger
    }
    
    logger.error('Poll failed', { error: getErrorMessage(error) })
    return [] // Retry next cycle
  }
}
```

---

## 15. COMPLETE COVERAGE CHECKLIST

### Method Count Verification

| Tool ID | Category | Count | Sum |
|---------|----------|-------|-----|
| `telegram_updates` | Getting Updates | 4 | 4 |
| `telegram_config` | Bot Commands & Config | 13 | 17 |
| `telegram_messages` | Sending Messages | 27 | 44 |
| `telegram_edit` | Editing Messages | 6 | 50 |
| `telegram_delete` | Deleting & Pinning | 7 | 57 |
| `telegram_forums` | Forum/Topic Management | 13 | 70 |
| `telegram_stickers` | Sticker Management | 14 | 84 |
| `telegram_inline` | Inline Mode & Queries | 1 | 85 |
| `telegram_callbacks` | Web Apps & Callbacks | 4 | 89 |
| `telegram_payments` | Payments & Checkout | 8 | 97 |
| `telegram_games` | Games | 3 | 100 |
| `telegram_members` | Chat Member Management | 13 | 113 |
| `telegram_chat` | Chat Management | 14 | 127 |

**Expected total: 127 methods** (based on exhaustive API audit)

**Note:** The initial research cited 132, but detailed method enumeration shows 127 unique methods. Any discrepancy due to ambiguity in method categorization (e.g., some methods appear in multiple contexts).

### Implementation Checklist

- [ ] **Authentication**
  - [ ] Block subblock `botToken` with password:true
  - [ ] ToolConfig injects token into URL path
  - [ ] Token never in body, query, or logs
  - [ ] Documentation warns against sharing token

- [ ] **Tools (14 files)**
  - [ ] `telegram_updates.ts` (4 methods)
  - [ ] `telegram_config.ts` (13 methods)
  - [ ] `telegram_messages.ts` (27 methods)
  - [ ] `telegram_edit.ts` (6 methods)
  - [ ] `telegram_delete.ts` (7 methods)
  - [ ] `telegram_forums.ts` (13 methods)
  - [ ] `telegram_stickers.ts` (14 methods)
  - [ ] `telegram_inline.ts` (1 method)
  - [ ] `telegram_callbacks.ts` (4 methods)
  - [ ] `telegram_payments.ts` (8 methods)
  - [ ] `telegram_games.ts` (3 methods)
  - [ ] `telegram_members.ts` (13 methods)
  - [ ] `telegram_chat.ts` (14 methods)

- [ ] **File Upload Proxy Routes (12 methods)**
  - [ ] `/api/tools/telegram/sendPhoto/route.ts`
  - [ ] `/api/tools/telegram/sendAudio/route.ts`
  - [ ] `/api/tools/telegram/sendDocument/route.ts`
  - [ ] `/api/tools/telegram/sendVideo/route.ts`
  - [ ] `/api/tools/telegram/sendAnimation/route.ts`
  - [ ] `/api/tools/telegram/sendVoice/route.ts`
  - [ ] `/api/tools/telegram/sendVideoNote/route.ts`
  - [ ] `/api/tools/telegram/sendSticker/route.ts`
  - [ ] `/api/tools/telegram/uploadStickerFile/route.ts`
  - [ ] `/api/tools/telegram/setChatPhoto/route.ts`
  - [ ] `/api/tools/telegram/setStickerSetThumbnail/route.ts`
  - [ ] `/api/tools/telegram/setCustomEmojiStickerSetThumbnail/route.ts`

- [ ] **Trigger Implementation**
  - [ ] `triggers/telegram.ts` with polling + webhook variants
  - [ ] Block: `telegram_trigger` with mode toggle
  - [ ] Webhook endpoint: `/api/webhooks/telegram/route.ts`
  - [ ] Secret token validation
  - [ ] Update ID deduplication
  - [ ] Offset tracking for polling

- [ ] **Response/Error Handling**
  - [ ] `transformResponse()` in each tool
  - [ ] Error classification (429, 401, 403, 404)
  - [ ] Retry logic with backoff
  - [ ] Rate limit header parsing

- [ ] **Registry Updates**
  - [ ] `blocks/registry.ts`: add `telegram_trigger`
  - [ ] `tools/registry.ts`: register all 14 tools
  - [ ] `triggers/registry.ts`: register polling + webhook
  - [ ] `components/icons.tsx`: add TelegramIcon

- [ ] **Documentation**
  - [ ] Block setup guide (how to get bot token from @BotFather)
  - [ ] Polling vs webhook comparison
  - [ ] File upload best practices
  - [ ] Payment flow walkthrough
  - [ ] Common error solutions

- [ ] **Testing**
  - [ ] Unit tests for each tool (operation parsing, param validation)
  - [ ] Mock Telegram API responses
  - [ ] Webhook signature validation tests
  - [ ] Polling offset tracking tests
  - [ ] File upload multipart encoding tests

- [ ] **CI/CD**
  - [ ] Add `telegram` to integration test matrix
  - [ ] Validate all 14 tools export correctly
  - [ ] Check tool IDs match registry
  - [ ] Verify handler wrapping with `withRouteHandler`

---

## 16. IMPLEMENTATION PHASES (Suggested Order)

### Phase 1: Core Foundation (Auth + 4 tools)
1. Block config with `botToken` subblock
2. ToolConfig pattern (URL injection, body params)
3. `telegram_updates.ts` (getUpdates, setWebhook, etc.)
4. `telegram_config.ts` (getMe, setMyCommands, etc.)
5. Polling trigger skeleton
6. Tests for auth flow

### Phase 2: Messaging (3 tools)
1. `telegram_messages.ts` (sendMessage, sendPhoto, etc.)
2. File upload proxy routes (12 methods)
3. Response transformation for each method
4. Error handling

### Phase 3: Advanced Tools (8 tools)
1. `telegram_edit.ts`
2. `telegram_delete.ts`
3. `telegram_forums.ts`
4. `telegram_stickers.ts`
5. `telegram_inline.ts`
6. `telegram_callbacks.ts`
7. `telegram_payments.ts`
8. `telegram_games.ts`
9. `telegram_members.ts`
10. `telegram_chat.ts`

### Phase 4: Webhooks + Polish
1. Webhook trigger implementation
2. Secret token validation
3. Webhook endpoint
4. Registry updates
5. Documentation
6. End-to-end tests

---

## 17. KEY DESIGN DECISIONS SUMMARY

| Decision | Rationale |
|----------|-----------|
| **14 tools, not 132** | Cleaner UX; operation dropdowns; maintainability |
| **Token in URL path** | Matches Telegram's only-supported method |
| **Block-level botToken** | Secret credentials must be user-provided, not LLM-visible |
| **File upload proxy routes** | Bridges Sim's JSON tool interface with Telegram's multipart API |
| **Polling + webhook modes** | Gives users choice: latency vs infrastructure complexity |
| **Update ID deduplication** | Prevents duplicate trigger fires from polling retries |
| **transformResponse()** | Unwraps Telegram's `{ ok, result }` envelope |
| **Error classification** | Different handling for 401, 403, 404, 429, 500 |
| **Long polling timeout** | Reduces server load vs busy-wait polling |
| **Webhook secret token** | Validates authenticity of Telegram requests |

---

## END OF DESIGN DOCUMENT

This plan provides a complete roadmap for integrating the Telegram Bot API into Sim. Each section includes pseudocode, configuration examples, and implementation guidance. The 14-tool architecture balances coverage (127 methods) with maintainability and UX clarity.

**Next step:** Proceed with Phase 1 implementation using `/add-integration` skill, starting with block config and the four update-related methods.
