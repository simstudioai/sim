import type { ToolConfig } from '@/tools/types'

export const TABLE_ID_PARAM = {
  type: 'string',
  required: true,
  description:
    'Table ID in the execution workspace. In a workflow, the table must belong to the same workspace as the workflow.',
  visibility: 'user-only',
} satisfies ToolConfig['params'][string]
