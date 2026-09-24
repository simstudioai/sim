import { z } from 'zod'
import { readSlackResponse } from '@/tools/slack/api'
import type { SlackListsOkResponse, SlackListsUpdateParams } from '@/tools/slack_lists/types'
import { OK_OUTPUT } from '@/tools/slack_lists/types'
import { slackListsHeaders } from '@/tools/slack_lists/utils'
import { slackListIdSchema } from '@/tools/slack_lists/validation'
import type { ToolConfig } from '@/tools/types'

export const slackListsUpdateTool: ToolConfig<SlackListsUpdateParams, SlackListsOkResponse> = {
  id: 'slack_lists_update',
  name: 'Slack Lists Rename List',
  description: 'Rename an existing Slack List.',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'New name for the List',
    },
  },
  request: {
    url: 'https://slack.com/api/slackLists.update',
    method: 'POST',
    headers: slackListsHeaders,
    body: (params) => {
      return {
        id: slackListIdSchema.parse(params.listId),
        name: z.string().trim().min(1, 'List name is required').parse(params.name),
      }
    },
  },
  transformResponse: async (response) => {
    await readSlackResponse(response)
    return { success: true, output: { ok: true } }
  },
  outputs: { ok: OK_OUTPUT },
}
