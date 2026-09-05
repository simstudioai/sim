import { filterUndefined } from '@sim/utils/object'
import { z } from 'zod'
import type { SlackListChannelsParams, SlackListChannelsResponse } from '@/tools/slack/types'
import { CONVERSATION_LIST_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import {
  assertSlackApiSuccess,
  requireSlackString,
  resolveSlackAccessToken,
} from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

type SlackConversation = SlackListChannelsResponse['output']['channels'][number]

const optionalString = z.string().optional()
const optionalBoolean = z.boolean().optional()
const optionalNumber = z.number().finite().optional()
const conversationText = z.object({ value: optionalString }).optional()

const slackConversationSchema = z.object({
  id: z.string().trim().min(1, 'Slack conversation ID is required'),
  name: optionalString,
  is_channel: optionalBoolean,
  is_group: optionalBoolean,
  is_im: optionalBoolean,
  is_mpim: optionalBoolean,
  user: optionalString,
  is_user_deleted: optionalBoolean,
  is_open: optionalBoolean,
  is_private: optionalBoolean,
  is_archived: optionalBoolean,
  is_general: optionalBoolean,
  is_member: optionalBoolean,
  is_shared: optionalBoolean,
  is_ext_shared: optionalBoolean,
  is_org_shared: optionalBoolean,
  num_members: optionalNumber,
  topic: conversationText,
  purpose: conversationText,
  created: optionalNumber,
  creator: optionalString,
  updated: optionalNumber,
  priority: optionalNumber,
})

const slackListConversationsResponseSchema = z.object({
  ok: z.boolean(),
  error: optionalString,
  channels: z.array(slackConversationSchema).optional(),
  response_metadata: z.object({ next_cursor: optionalString }).optional(),
})

function mapSlackConversation(
  conversation: z.output<typeof slackConversationSchema>
): SlackConversation {
  const { id, topic, purpose, ...fields } = conversation
  return {
    id,
    ...filterUndefined({
      ...fields,
      topic: topic?.value,
      purpose: purpose?.value,
    }),
  }
}

function resolveBooleanParam(value: unknown, label: string, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false`)
  return value
}

function resolveConversationLimit(value: unknown): number {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return 100
  }
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('Channel limit must be an integer between 1 and 200')
  }
  return limit
}

export const slackListChannelsTool: ToolConfig<SlackListChannelsParams, SlackListChannelsResponse> =
  {
    id: 'slack_list_channels',
    name: 'Slack List Channels',
    description:
      'List accessible Slack conversations. Credential-group user tokens also return one-to-one and group direct messages.',
    version: '1.1.0',

    oauth: {
      required: true,
      provider: 'slack',
      /** Slack enforces the required scope for the target conversation type. */
      requiredScopes: [],
      authoritativeParams: ['credentialType'],
    },

    params: {
      authMethod: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Authentication method: oauth or bot_token',
      },
      botToken: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Bot token for Custom Bot',
      },
      accessToken: {
        type: 'string',
        required: false,
        visibility: 'hidden',
        description: 'OAuth access token or bot token for Slack API',
      },
      credentialType: {
        type: 'string',
        required: false,
        visibility: 'hidden',
        description: 'Credential type supplied by authorized token resolution',
      },
      includePrivate: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Include private channels the bot is a member of (default: true)',
      },
      excludeArchived: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Exclude archived channels (default: true)',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of channels to return (default: 100, max: 200)',
      },
      cursor: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Pagination cursor from a previous response.next_cursor',
      },
    },

    request: {
      url: (params) => {
        const url = new URL('https://slack.com/api/conversations.list')
        const conversationTypes = ['public_channel']
        if (resolveBooleanParam(params.includePrivate, 'Include private channels', true)) {
          conversationTypes.push('private_channel')
        }
        if (params.credentialType === 'managed_oauth') {
          conversationTypes.push('im', 'mpim')
        }
        url.searchParams.set('types', conversationTypes.join(','))
        url.searchParams.set(
          'exclude_archived',
          String(resolveBooleanParam(params.excludeArchived, 'Exclude archived channels', true))
        )
        url.searchParams.set('limit', String(resolveConversationLimit(params.limit)))
        if (params.cursor !== undefined) {
          url.searchParams.set('cursor', requireSlackString(params.cursor, 'Pagination cursor'))
        }
        return url.toString()
      },
      method: 'GET',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolveSlackAccessToken(params)}`,
      }),
    },

    transformResponse: async (response) => {
      const data = slackListConversationsResponseSchema.parse(await response.json())
      assertSlackApiSuccess(data, 'Failed to list conversations from Slack')
      if (!data.channels) {
        throw new Error('Slack returned a malformed conversations list')
      }

      const channels = data.channels.map(mapSlackConversation)
      const ids = channels.map((conversation) => conversation.id)
      const names = channels.flatMap((conversation) =>
        conversation.name === undefined ? [] : [conversation.name]
      )
      const nextCursor = data.response_metadata?.next_cursor?.trim() || null

      return {
        success: true,
        output: {
          channels,
          ids,
          names,
          count: channels.length,
          nextCursor,
        },
      }
    },

    outputs: {
      channels: {
        type: 'array',
        description:
          'Accessible public and private channels, plus direct and group DMs for credential-group user tokens',
        items: {
          type: 'object',
          properties: CONVERSATION_LIST_OUTPUT_PROPERTIES,
        },
      },
      ids: {
        type: 'array',
        description: 'Conversation IDs for every returned channel or DM',
        items: { type: 'string', description: 'Slack conversation ID' },
      },
      names: {
        type: 'array',
        description: 'Names of returned channels and group DMs; one-to-one DMs have no name',
        items: { type: 'string', description: 'Slack conversation name' },
      },
      count: {
        type: 'number',
        description: 'Total number of conversations returned',
      },
      nextCursor: {
        type: 'string',
        description: 'Cursor for the next page; null if no more pages',
        optional: true,
      },
    },
  }
