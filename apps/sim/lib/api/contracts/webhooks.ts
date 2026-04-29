import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const webhooksRouteQuerySchema = z.object({
  workflowId: z.string().nullable(),
  blockId: z.string().nullable(),
})

export const webhooksByBlockQuerySchema = z.object({
  workflowId: z.string().min(1),
  blockId: z.string().min(1),
})

export const webhookProviderConfigSchema = z.record(z.string(), z.unknown())

export const webhookDataSchema = z
  .object({
    id: z.string(),
    path: z.string().optional(),
    providerConfig: webhookProviderConfigSchema.optional(),
  })
  .passthrough()

export type WebhookData = z.output<typeof webhookDataSchema>

export const webhookListItemSchema = z.object({
  webhook: webhookDataSchema,
  workflow: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
})

export type WebhookListItem = z.output<typeof webhookListItemSchema>

export const webhookUpsertBodySchema = z
  .object({
    workflowId: z.string().optional(),
    path: z.string().optional(),
    provider: z.string().optional(),
    providerConfig: webhookProviderConfigSchema.optional(),
    blockId: z.string().optional(),
  })
  .passthrough()

export type WebhookUpsertBody = z.input<typeof webhookUpsertBodySchema>

export const webhookIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const webhookPatchBodySchema = z
  .object({
    isActive: z.boolean().optional(),
    failedCount: z
      .number({ error: 'failedCount must be a number' })
      .finite('failedCount must be a valid number')
      .int('failedCount must be an integer')
      .min(0, 'failedCount must be at least 0')
      .optional(),
  })
  .passthrough()
export type WebhookPatchBody = z.input<typeof webhookPatchBodySchema>

export const webhookPollingParamsSchema = z.object({
  provider: z.string().min(1),
})

export const webhookTriggerParamsSchema = z.object({
  path: z.string().min(1),
})

export const webhookSvixHeadersSchema = z.object({
  'svix-id': z.string().min(1),
  'svix-timestamp': z.string().min(1),
  'svix-signature': z.string().min(1),
})

export const agentMailEnvelopeSchema = z
  .object({
    event_type: z.string(),
    message: z.unknown().optional(),
  })
  .passthrough()

const agentMailAttachmentSchema = z
  .object({
    attachment_id: z.string(),
    filename: z.string(),
    content_type: z.string(),
    size: z.number(),
    inline: z.boolean().optional(),
  })
  .passthrough()

export const agentMailMessageSchema = z
  .object({
    message_id: z.string(),
    thread_id: z.string(),
    inbox_id: z.string(),
    organization_id: z.string().optional(),
    from_: z.string(),
    to: z.array(z.string()),
    cc: z.array(z.string()),
    bcc: z.array(z.string()).optional(),
    reply_to: z.array(z.string()).optional(),
    subject: z.string(),
    preview: z.string().optional(),
    text: z.string().nullable(),
    html: z.string().nullable(),
    attachments: z.array(agentMailAttachmentSchema),
    in_reply_to: z.string().optional(),
    references: z.array(z.string()).optional(),
    labels: z.array(z.string()).optional(),
    sort_key: z.string().optional(),
    updated_at: z.string().optional(),
    created_at: z.string(),
  })
  .passthrough()

export const listWebhooksByBlockResponseSchema = z.object({
  webhooks: z.array(webhookListItemSchema),
})

export type ListWebhooksByBlockResponse = z.output<typeof listWebhooksByBlockResponseSchema>

export const listWebhooksByBlockContract = defineRouteContract({
  method: 'GET',
  path: '/api/webhooks',
  query: webhooksByBlockQuerySchema,
  response: {
    mode: 'json',
    schema: listWebhooksByBlockResponseSchema,
  },
})
