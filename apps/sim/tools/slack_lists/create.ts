import { z } from 'zod'
import { readSlackResponse } from '@/tools/slack/api'
import type { SlackListsCreateParams, SlackListsCreateResponse } from '@/tools/slack_lists/types'
import { LIST_COLUMN_OUTPUT_PROPERTIES } from '@/tools/slack_lists/types'
import {
  listColumnResponseSchema,
  slackListDescription,
  slackListsHeaders,
} from '@/tools/slack_lists/utils'
import { columnSchema, parseSlackListsJson } from '@/tools/slack_lists/validation'
import type { ToolConfig } from '@/tools/types'

export const slackListsCreateTool: ToolConfig<SlackListsCreateParams, SlackListsCreateResponse> = {
  id: 'slack_lists_create',
  name: 'Slack Lists Create List',
  description: 'Create a Slack List with an optional column schema. Requires a paid Slack plan.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'slack',
    credentialKind: 'service-account',
    requiredScopes: ['lists:write'],
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Resolved custom Slack bot token',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the new List',
    },
    schema: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Column definitions with key, name, type, and optional is_primary_column/options. Read returned column IDs before writing rows.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text description, encoded as Slack rich text',
    },
    todoMode: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Add task tracking fields for completion, assignee, and due date',
    },
  },
  request: {
    url: 'https://slack.com/api/slackLists.create',
    method: 'POST',
    headers: slackListsHeaders,
    body: (params) => {
      const schema =
        params.schema === undefined
          ? undefined
          : parseSlackListsJson(
              params.schema,
              z
                .array(columnSchema)
                .min(1)
                .refine(
                  (columns) => columns.filter((column) => column.is_primary_column).length <= 1,
                  'Only one primary column is allowed'
                ),
              'schema'
            )
      return {
        name: z.string().trim().min(1, 'List name is required').parse(params.name),
        schema,
        description_blocks:
          params.description === undefined
            ? undefined
            : slackListDescription(z.string().min(1).parse(params.description)),
        todo_mode: params.todoMode === undefined ? undefined : z.boolean().parse(params.todoMode),
      }
    },
  },
  transformResponse: async (response) => {
    const data = await readSlackResponse(response)
    const result = z
      .object({
        list_id: z.string(),
        list_metadata: z.object({ schema: z.array(listColumnResponseSchema) }).optional(),
      })
      .parse(data)
    return {
      success: true,
      output: { listId: result.list_id, schema: result.list_metadata?.schema ?? null },
    }
  },
  outputs: {
    listId: { type: 'string', description: 'Created Slack List ID' },
    schema: {
      type: 'array',
      description: 'Column schema with IDs; null if Slack omitted it',
      items: { type: 'object', properties: LIST_COLUMN_OUTPUT_PROPERTIES },
      nullable: true,
    },
  },
}
