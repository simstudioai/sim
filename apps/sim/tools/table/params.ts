import type { ToolConfig } from '@/tools/types'

export const TABLE_ID_PARAM = {
  type: 'string',
  required: true,
  description:
    'Table ID in the execution workspace. In a workflow, the table must belong to the same workspace as the workflow.',
  visibility: 'user-only',
} satisfies ToolConfig['params'][string]

/** Column projection for the row-query tools; shared so both query tools describe it identically. */
export const TABLE_COLUMNS_PARAM = {
  type: 'array',
  required: false,
  items: { type: 'string' },
  description:
    "Stable column IDs or table column names to include in each row data object. Omit or pass an empty array to return all columns. A reference that matches no column is ignored; if none match, each row's data is empty.",
  visibility: 'user-or-llm',
} satisfies ToolConfig['params'][string]
