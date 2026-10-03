import { z } from 'zod'

export const slackListIdSchema = z.string().trim().min(1, 'List ID is required')
export const slackListItemIdSchema = z.string().trim().min(1, 'Item ID is required')
const id = z.string().trim().min(1)
export const slackListAccessSchema = z
  .object({
    list_id: slackListIdSchema,
    access_level: z.enum(['read', 'write', 'owner']),
    user_ids: z.array(id).min(1, 'At least one user ID is required').optional(),
    channel_ids: z.array(id).min(1, 'At least one channel ID is required').optional(),
  })
  .refine((value) => (value.user_ids !== undefined) !== (value.channel_ids !== undefined), {
    message: 'Provide exactly one of userIds or channelIds',
    path: ['user_ids'],
  })
  .refine((value) => value.access_level !== 'owner' || value.channel_ids === undefined, {
    message: 'Owner access can only be granted to users',
    path: ['access_level'],
  })

const richText = z
  .object({
    type: z.literal('rich_text'),
    elements: z.array(z.object({ type: id }).passthrough()).min(1),
  })
  .passthrough()
const strings = z.array(z.string())

const cellValues = {
  rich_text: z.array(richText).optional(),
  number: z.array(z.number()).optional(),
  select: strings.max(50).optional(),
  date: z.array(z.iso.date()).optional(),
  user: z.array(id).optional(),
  channel: z.array(id).optional(),
  attachment: z.array(id).optional(),
  checkbox: z.boolean().optional(),
  email: z.array(z.email()).optional(),
  phone: strings.optional(),
  rating: z.array(z.number().int()).optional(),
  timestamp: z.array(z.number().int()).optional(),
  message: z.array(z.url()).optional(),
  link: z
    .array(
      z.object({
        original_url: z.url(),
        display_as_url: z.boolean().optional(),
        display_name: z.string().optional(),
      })
    )
    .optional(),
  reference: z
    .array(
      z
        .object({
          message: z.object({ channel_id: id, ts: id, thread_ts: id.optional() }).optional(),
          list_record: z.object({ list_id: id, row_id: id }).optional(),
          file: z.object({ file_id: id }).optional(),
          canvas_section: z.object({ file_id: id, section_id: id }).optional(),
        })
        .strict()
        .refine(
          (reference) =>
            Object.values(reference).filter((value) => value !== undefined).length === 1,
          'Each reference must contain exactly one of message, list_record, file, or canvas_section'
        )
    )
    .optional(),
}

function hasOneValue(value: Record<string, unknown>) {
  return Object.keys(cellValues).filter((key) => value[key] !== undefined).length === 1
}

export const fieldSchema = z
  .object({ column_id: id, ...cellValues })
  .strict()
  .refine(
    hasOneValue,
    'Each field must contain exactly one typed value; use rich_text for text cells'
  )
export const updateCellSchema = z
  .object({ row_id: id, column_id: id, ...cellValues })
  .strict()
  .refine(
    hasOneValue,
    'Each cell must contain exactly one typed value; use rich_text for text cells'
  )

export const columnSchema = z
  .object({
    key: id,
    name: id,
    type: z.enum([
      'text',
      'message',
      'number',
      'select',
      'date',
      'user',
      'attachment',
      'checkbox',
      'email',
      'phone',
      'channel',
      'rating',
      'created_by',
      'last_edited_by',
      'created_time',
      'last_edited_time',
      'vote',
      'canvas',
      'reference',
      'link',
    ]),
    is_primary_column: z.boolean().optional(),
    options: z
      .object({
        choices: z
          .array(z.object({ value: id, label: id, color: id }))
          .max(100)
          .optional(),
        format: z.string().optional(),
        precision: z.number().int().optional(),
        date_format: z.string().optional(),
        emoji: z.string().optional(),
        emoji_team_id: z.string().optional(),
        max: z.number().int().optional(),
        default_value_typed: z
          .object({
            user: strings.optional(),
            channel: strings.optional(),
            select: strings.optional(),
          })
          .strict()
          .optional(),
        show_member_name: z.boolean().optional(),
        notify_users: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (column) => !column.is_primary_column || column.type === 'text',
    'The primary column must have type text'
  )

export function parseSlackListsJson<T>(value: unknown, schema: z.ZodType<T>, field: string): T {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${field} must be valid JSON`)
    }
  }
  const result = schema.safeParse(parsed)
  if (!result.success) throw new Error(`${field}: ${result.error.message}`)
  return result.data
}
