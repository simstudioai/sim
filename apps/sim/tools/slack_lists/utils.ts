import { z } from 'zod'
import type { SlackListsAuthParams } from '@/tools/slack_lists/types'

export const slackListsHeaders = (params: SlackListsAuthParams) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${z.string().trim().min(1, 'A connected Slack credential is required').parse(params.accessToken)}`,
})

export const listFieldResponseSchema = z
  .object({
    column_id: z.string().optional(),
    key: z.string().optional(),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    text: z.string().optional(),
    rich_text: z.array(z.record(z.string(), z.unknown())).optional(),
    number: z.array(z.number()).optional(),
    select: z.array(z.string()).optional(),
    date: z.array(z.string()).optional(),
    user: z.array(z.string()).optional(),
    channel: z.array(z.string()).optional(),
    attachment: z.array(z.string()).optional(),
    checkbox: z.union([z.boolean(), z.array(z.boolean())]).optional(),
    email: z.array(z.string()).optional(),
    phone: z.array(z.string()).optional(),
    rating: z.array(z.number()).optional(),
    timestamp: z.array(z.number()).optional(),
    message: z
      .array(
        z.object({
          value: z.string(),
          channel_id: z.string(),
          ts: z.string(),
          thread_ts: z.string().optional(),
        })
      )
      .optional(),
    link: z
      .array(
        z
          .object({
            originalUrl: z.string(),
            displayAsUrl: z.boolean().optional(),
            displayName: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    reference: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough()

export const listItemResponseSchema = z.object({
  id: z.string(),
  list_id: z.string(),
  date_created: z.number(),
  fields: z.array(listFieldResponseSchema),
  created_by: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  updated_by: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  updated_timestamp: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  parent_record_id: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
})

/** Response column types include derived types such as rich_text and todo fields. */
export const listColumnResponseSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  type: z.string(),
  is_primary_column: z.boolean().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
})

export const listSummaryResponseSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    list_metadata: z.object({ schema: z.array(listColumnResponseSchema) }),
  })
  .transform((list) => ({ id: list.id, title: list.title, schema: list.list_metadata.schema }))

export function slackListDescription(text: string) {
  return [
    {
      type: 'rich_text',
      elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text }] }],
    },
  ]
}
