import { z } from 'zod'
import { readSlackResponse } from '@/tools/slack/api'
import type { SlackListsOkResponse, SlackListsUpdateParams } from '@/tools/slack_lists/types'
import { OK_OUTPUT } from '@/tools/slack_lists/types'
import { slackListDescription, slackListsHeaders } from '@/tools/slack_lists/utils'
import { slackListIdSchema } from '@/tools/slack_lists/validation'
import type { ToolConfig } from '@/tools/types'

export const slackListsUpdateTool: ToolConfig<SlackListsUpdateParams, SlackListsOkResponse> = {
  id: 'slack_lists_update',
  name: 'Slack Lists Update List',
  description: 'Update a Slack List name, description, or task tracking fields.',
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
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Slack List ID, from the List URL or Create List output',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the List',
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
      description: 'Enable or disable task tracking fields; omit to leave unchanged',
    },
  },
  request: {
    url: 'https://slack.com/api/slackLists.update',
    method: 'POST',
    headers: slackListsHeaders,
    body: (params) => {
      if (
        params.name === undefined &&
        params.description === undefined &&
        params.todoMode === undefined
      ) {
        throw new Error('Provide a List name, description, or task tracking setting')
      }
      return {
        id: slackListIdSchema.parse(params.listId),
        name:
          params.name === undefined
            ? undefined
            : z.string().trim().min(1, 'List name is required').parse(params.name),
        description_blocks:
          params.description === undefined
            ? undefined
            : slackListDescription(z.string().min(1).parse(params.description)),
        todo_mode: params.todoMode === undefined ? undefined : z.boolean().parse(params.todoMode),
      }
    },
  },
  transformResponse: async (response) => {
    await readSlackResponse(response)
    return { success: true, output: { ok: true } }
  },
  outputs: { ok: OK_OUTPUT },
}
