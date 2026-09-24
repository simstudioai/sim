import type { z } from 'zod'
import type { listColumnResponseSchema, listFieldResponseSchema } from '@/tools/slack_lists/utils'
import type { columnSchema, fieldSchema, updateCellSchema } from '@/tools/slack_lists/validation'
import type { OutputProperty, ToolResponse } from '@/tools/types'

export type SlackListColumn = z.infer<typeof columnSchema>
export type SlackListResponseColumn = z.infer<typeof listColumnResponseSchema>
export type SlackListField = z.infer<typeof fieldSchema>
export type SlackListCell = z.infer<typeof updateCellSchema>

export interface SlackListsAuthParams {
  accessToken: string
}

export interface SlackListsCreateParams extends SlackListsAuthParams {
  name: string
  schema?: SlackListColumn[] | string
  description?: string
  todoMode?: boolean
}

export interface SlackListsUpdateParams extends SlackListsAuthParams {
  listId: string
  name: string
}

export interface SlackListsItemsListParams extends SlackListsAuthParams {
  listId: string
  limit?: number
  cursor?: string
  archived?: boolean
  includeList?: boolean
}

export interface SlackListsItemParams extends SlackListsAuthParams {
  listId: string
  itemId: string
}

export interface SlackListsItemsCreateParams extends SlackListsAuthParams {
  listId: string
  initialFields?: SlackListField[] | string
  parentItemId?: string
  duplicatedItemId?: string
}

export interface SlackListsItemsUpdateParams extends SlackListsAuthParams {
  listId: string
  cells: SlackListCell[] | string
}

export interface SlackListItem {
  id: string
  list_id: string
  date_created: number
  fields: z.infer<typeof listFieldResponseSchema>[]
  created_by: string | null
  updated_by: string | null
  updated_timestamp: string | null
  parent_record_id: string | null
}

export interface SlackListSummary {
  id: string
  title: string
  schema: SlackListResponseColumn[]
}

export interface SlackListsCreateResponse extends ToolResponse {
  output: { listId: string; schema: SlackListResponseColumn[] | null }
}
export interface SlackListsItemsListResponse extends ToolResponse {
  output: { items: SlackListItem[]; list: SlackListSummary | null; nextCursor: string }
}
export interface SlackListsItemsCreateResponse extends ToolResponse {
  output: { item: SlackListItem }
}
export interface SlackListsItemsInfoResponse extends ToolResponse {
  output: { item: SlackListItem; list: SlackListSummary }
}
export interface SlackListsOkResponse extends ToolResponse {
  output: { ok: boolean }
}

export const LIST_COLUMN_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Column ID' },
  key: { type: 'string', description: 'Column key' },
  name: { type: 'string', description: 'Column name' },
  type: { type: 'string', description: 'Slack column type' },
  is_primary_column: {
    type: 'boolean',
    optional: true,
    description: 'Whether this is the primary text column',
  },
  options: {
    type: 'json',
    optional: true,
    description: 'Type-specific column settings, including select choices (value, label, color)',
  },
} as const satisfies Record<string, OutputProperty>

export const LIST_COLUMNS_OUTPUT = {
  type: 'array',
  description: 'Column schema: use id as column_id when writing cells',
  items: { type: 'object', properties: LIST_COLUMN_OUTPUT_PROPERTIES },
} as const satisfies OutputProperty

export const LIST_ITEM_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Row ID; use as row_id for cell updates' },
  list_id: { type: 'string', description: 'Parent List ID' },
  date_created: { type: 'number', description: 'Creation Unix timestamp' },
  fields: {
    type: 'array',
    description: 'Cells with column_id, key, value and type-specific values',
    items: {
      type: 'object',
      properties: {
        column_id: { type: 'string', optional: true, description: 'Column ID' },
        key: { type: 'string', description: 'Column key' },
        value: { type: 'json', description: 'Legacy scalar value; use typed values for writes' },
        text: {
          type: 'string',
          optional: true,
          description: 'Display text; not accepted for writes',
        },
        rich_text: { type: 'json', optional: true, description: 'Slack Block Kit rich text' },
        number: {
          type: 'array',
          optional: true,
          description: 'Numeric values',
          items: { type: 'number' },
        },
        select: {
          type: 'array',
          optional: true,
          description: 'Select choice values',
          items: { type: 'string' },
        },
        date: {
          type: 'array',
          optional: true,
          description: 'Dates in YYYY-MM-DD format',
          items: { type: 'string' },
        },
        user: {
          type: 'array',
          optional: true,
          description: 'Slack user IDs',
          items: { type: 'string' },
        },
        channel: {
          type: 'array',
          optional: true,
          description: 'Slack channel IDs',
          items: { type: 'string' },
        },
        attachment: {
          type: 'array',
          optional: true,
          description: 'Slack file IDs',
          items: { type: 'string' },
        },
        checkbox: {
          type: 'json',
          optional: true,
          description:
            'Checkbox boolean or boolean array returned by Slack; write a scalar boolean',
        },
        email: {
          type: 'array',
          optional: true,
          description: 'Email values',
          items: { type: 'string' },
        },
        phone: {
          type: 'array',
          optional: true,
          description: 'Phone values',
          items: { type: 'string' },
        },
        rating: {
          type: 'array',
          optional: true,
          description: 'Rating values',
          items: { type: 'number' },
        },
        timestamp: {
          type: 'array',
          optional: true,
          description: 'Unix timestamps',
          items: { type: 'number' },
        },
        message: {
          type: 'json',
          optional: true,
          description: 'Message references with value, channel_id, ts, and optional thread_ts',
        },
        link: {
          type: 'json',
          optional: true,
          description:
            'Link values with originalUrl and optional displayAsUrl/displayName/attachment',
        },
        reference: {
          type: 'json',
          optional: true,
          description: 'Typed references to messages, List rows, files, or canvas sections',
        },
      },
    },
  },
  created_by: { type: 'string', nullable: true, description: 'Creator user ID' },
  updated_by: { type: 'string', nullable: true, description: 'Last editor user ID' },
  updated_timestamp: { type: 'string', nullable: true, description: 'Last update timestamp' },
  parent_record_id: { type: 'string', nullable: true, description: 'Parent row ID for subtasks' },
} as const satisfies Record<string, OutputProperty>

export const LIST_ITEM_OUTPUT = {
  type: 'object',
  description: 'Slack List row',
  properties: LIST_ITEM_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty
export const LIST_SUMMARY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'List ID' },
  title: { type: 'string', description: 'List title' },
  schema: LIST_COLUMNS_OUTPUT,
} as const satisfies Record<string, OutputProperty>
export const LIST_SUMMARY_OUTPUT = {
  type: 'object',
  description: 'Parent List title and column schema',
  properties: LIST_SUMMARY_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty
export const OK_OUTPUT = {
  type: 'boolean',
  description: 'Whether Slack completed the operation',
} as const
