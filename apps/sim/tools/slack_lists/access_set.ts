import { readSlackResponse } from '@/tools/slack/api'
import type { SlackListsAccessSetParams, SlackListsOkResponse } from '@/tools/slack_lists/types'
import { OK_OUTPUT } from '@/tools/slack_lists/types'
import { slackListsHeaders } from '@/tools/slack_lists/utils'
import { parseSlackListsJson, slackListAccessSchema } from '@/tools/slack_lists/validation'
import type { ToolConfig } from '@/tools/types'

export const slackListsAccessSetTool: ToolConfig<SlackListsAccessSetParams, SlackListsOkResponse> =
  {
    id: 'slack_lists_access_set',
    name: 'Slack Lists Share List',
    description:
      'Grant users or channels access to a Slack List. Provide exactly one of userIds or channelIds. Read allows viewing, write allows editing, and owner grants ownership to users only; only a current owner can grant ownership.',
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
      accessLevel: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Access to grant: read, write, or owner. Ownership can only be granted to users.',
      },
      userIds: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Nonempty JSON array of Slack user IDs, e.g. ["U0123456789"]. Omit channelIds.',
      },
      channelIds: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Nonempty JSON array of Slack channel IDs, e.g. ["C0123456789"]. Omit userIds. Supports read or write access.',
      },
    },
    request: {
      url: 'https://slack.com/api/slackLists.access.set',
      method: 'POST',
      headers: slackListsHeaders,
      body: (params) =>
        slackListAccessSchema.parse({
          list_id: params.listId,
          access_level: params.accessLevel,
          user_ids: parseSlackListsJson(
            params.userIds,
            slackListAccessSchema.shape.user_ids,
            'userIds'
          ),
          channel_ids: parseSlackListsJson(
            params.channelIds,
            slackListAccessSchema.shape.channel_ids,
            'channelIds'
          ),
        }),
    },
    transformResponse: async (response) => {
      await readSlackResponse(response)
      return { success: true, output: { ok: true } }
    },
    outputs: { ok: OK_OUTPUT },
  }
