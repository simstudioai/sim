import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** Bounds both non-interactive output and persistent interactive CLI chat. */
export const MAX_V2_CHAT_PROMPT_LENGTH = 10 * 1024 * 1024
export const MAX_V2_CHAT_ATTACHMENTS = 5
export const MAX_V2_CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_V2_CHAT_TEXT_ATTACHMENT_BYTES = 200 * 1024
export const MAX_V2_CHAT_ATTACHMENTS_TOTAL_BYTES = 10 * 1024 * 1024
export const MAX_V2_CHAT_ATTACHMENT_NAME_LENGTH = 255
export const MAX_V2_CHAT_CONTINUATION_TOKEN_LENGTH = 4096
export const MAX_V2_CHAT_CONTEXTS = 50
export const MAX_V2_CHAT_CONTEXT_LABEL_LENGTH = 255
export const MAX_V2_CHAT_CONTEXT_ID_LENGTH = 255
/** Prevent small compressed inputs from expanding into unbounded image allocations. */
export const MAX_V2_CHAT_IMAGE_DIMENSION = 8192
/** Caps one 4-byte decoded image surface at roughly 64 MiB before resize overhead. */
export const MAX_V2_CHAT_IMAGE_PIXELS = 16_000_000
/** Caps all decoded image surfaces in one request at roughly 128 MiB. */
export const MAX_V2_CHAT_IMAGES_TOTAL_PIXELS = 32_000_000

const MAX_V2_CHAT_ATTACHMENT_BASE64_LENGTH = Math.ceil(MAX_V2_CHAT_ATTACHMENTS_TOTAL_BYTES / 3) * 4
const MAX_V2_CHAT_JSON_OVERHEAD_BYTES = 64 * 1024

/**
 * A prompt byte may occupy six transport bytes as a JSON `\u00XX` escape;
 * attachment base64 is already ASCII. This cap is deliberately a transport
 * bound, while the decoded prompt/file limits are enforced below and at the
 * route's attachment-validation boundary.
 */
export const MAX_V2_CHAT_BODY_BYTES =
  MAX_V2_CHAT_PROMPT_LENGTH * 6 +
  MAX_V2_CHAT_ATTACHMENT_BASE64_LENGTH +
  MAX_V2_CHAT_JSON_OVERHEAD_BYTES

export const V2_CHAT_IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const

export const V2_CHAT_TEXT_MEDIA_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'text/html',
  'text/css',
  'text/javascript',
  'text/typescript',
  'text/xml',
  'text/yaml',
  'application/json',
  'application/jsonl',
  'application/x-ndjson',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
] as const

export const V2_CHAT_DOCUMENT_MEDIA_TYPES = ['application/pdf'] as const

const v2ChatContextIdSchema = z.string().trim().min(1).max(MAX_V2_CHAT_CONTEXT_ID_LENGTH)
const v2ChatContextLabelSchema = z.string().trim().min(1).max(MAX_V2_CHAT_CONTEXT_LABEL_LENGTH)

/**
 * Identity-bearing tags supported by the public CLI surface. The home client
 * uses the same context kinds; this deliberately exposes only resources whose
 * stable ids are already available from public v2 list endpoints.
 */
export const v2ChatContextSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('workflow'),
      workflowId: v2ChatContextIdSchema,
      label: v2ChatContextLabelSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('table'),
      tableId: v2ChatContextIdSchema,
      label: v2ChatContextLabelSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('file'),
      fileId: v2ChatContextIdSchema,
      label: v2ChatContextLabelSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('knowledge'),
      knowledgeId: v2ChatContextIdSchema,
      label: v2ChatContextLabelSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('logs'),
      executionId: v2ChatContextIdSchema,
      label: v2ChatContextLabelSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('skill'),
      skillId: v2ChatContextIdSchema,
      label: v2ChatContextLabelSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('mcp'),
      serverId: v2ChatContextIdSchema,
      label: v2ChatContextLabelSchema,
    })
    .strict(),
])

export type V2ChatContext = z.output<typeof v2ChatContextSchema>

const textEncoder = new TextEncoder()

const v2ChatAttachmentSchema = z
  .object({
    // Basenames only: local paths belong to the CLI process and must never
    // cross the API boundary.
    name: z
      .string()
      .trim()
      .min(1, 'Attachment name is required')
      .max(MAX_V2_CHAT_ATTACHMENT_NAME_LENGTH)
      .refine(
        (value) => value !== '.' && value !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(value),
        'Attachment name must be a file basename'
      ),
    mediaType: z
      .string()
      .trim()
      .toLowerCase()
      .max(127)
      .regex(
        /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/,
        'Attachment mediaType must be a MIME type without parameters'
      ),
    // Semantic validation performs strict canonical-base64 decoding, byte
    // sniffing, and the type-specific decoded limits after workspace auth.
    data: z.string().min(4).max(MAX_V2_CHAT_ATTACHMENT_BASE64_LENGTH),
  })
  .strict()

export type V2ChatAttachment = z.output<typeof v2ChatAttachmentSchema>

export const v2ChatBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    prompt: z
      .string()
      .max(MAX_V2_CHAT_PROMPT_LENGTH, 'Prompt cannot exceed 10 MiB')
      .refine(
        (value) => textEncoder.encode(value).byteLength <= MAX_V2_CHAT_PROMPT_LENGTH,
        'Prompt cannot exceed 10 MiB'
      ),
    continuationToken: z.string().min(1).max(MAX_V2_CHAT_CONTINUATION_TOKEN_LENGTH).optional(),
    /** Normal Mothership is the default; this explicitly selects its read-only projection. */
    readOnly: z.boolean().optional().default(false),
    attachments: z.array(v2ChatAttachmentSchema).max(MAX_V2_CHAT_ATTACHMENTS).optional(),
    contexts: z.array(v2ChatContextSchema).max(MAX_V2_CHAT_CONTEXTS).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.prompt.trim() && !value.attachments?.length) {
      context.addIssue({
        code: 'custom',
        path: ['prompt'],
        message: 'Prompt or at least one attachment is required',
      })
    }
  })
export type V2ChatBody = z.input<typeof v2ChatBodySchema>

/**
 * A normal workspace Mothership turn. Omit `continuationToken` for a one-shot
 * or the first interactive turn; pass the latest server-issued token to
 * continue the same private conversation. `readOnly` explicitly selects the
 * secretless query projection. Successful responses are SSE so proxies stay
 * alive during long agent turns and callers can cancel the run.
 */
export const v2ChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/chat',
  body: v2ChatBodySchema,
  response: { mode: 'stream' },
})
