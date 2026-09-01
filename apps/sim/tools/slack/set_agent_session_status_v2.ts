import type {
  SlackAgentSessionStatus,
  SlackSetAgentSessionStatusV2Params,
  SlackSetAgentSessionStatusV2Response,
} from '@/tools/slack/types'
import {
  assertSlackApiSuccess,
  requireSlackAgentSessionStatus,
  requireSlackString,
  resolveSlackAccessToken,
} from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

interface SlackSetAgentSessionStatusApiResponse {
  ok?: boolean
  error?: string
  status?: SlackAgentSessionStatus
  agent_status?: SlackAgentSessionStatus
  title?: string
}

export const slackSetAgentSessionStatusV2Tool: ToolConfig<
  SlackSetAgentSessionStatusV2Params,
  SlackSetAgentSessionStatusV2Response
> = {
  id: 'slack_set_agent_session_status_v2',
  name: 'Slack Set Agent Session Status',
  description: 'Create or update the state of a Slack agent session associated with a thread.',
  version: '2.0.0',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['chat:write', 'chat:write.customize'],
    credentialKind: 'service-account',
  },
  params: {
    authMethod: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Slack authentication method',
    },
    botToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Custom Slack bot token',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Resolved custom Slack bot token',
    },
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel ID containing the agent session thread',
    },
    threadTs: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Timestamp of the thread associated with the agent session',
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Agent session state: active, processing, suspended, or closed',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title used when creating the agent session, up to 200 characters',
    },
    initiatorUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Slack user ID that initiated the session',
    },
    iconEmoji: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Emoji used to customize the agent identity',
    },
    iconUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image URL used to customize the agent identity',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name used to customize the agent identity',
    },
  },
  request: {
    url: () => 'https://slack.com/api/agents.sessions.setStatus',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${resolveSlackAccessToken(params)}`,
    }),
    body: (params) => {
      const title = params.title?.trim()
      if (title && title.length > 200)
        throw new Error('Session Title must be 200 characters or fewer')

      return {
        channel_id: requireSlackString(params.channel, 'Channel'),
        thread_ts: requireSlackString(params.threadTs, 'Thread Timestamp'),
        status: requireSlackAgentSessionStatus(params.status),
        ...(title ? { title } : {}),
        ...(params.initiatorUserId?.trim()
          ? { initiator_user_id: params.initiatorUserId.trim() }
          : {}),
        ...(params.iconEmoji?.trim() ? { icon_emoji: params.iconEmoji.trim() } : {}),
        ...(params.iconUrl?.trim() ? { icon_url: params.iconUrl.trim() } : {}),
        ...(params.username?.trim() ? { username: params.username.trim() } : {}),
      }
    },
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as SlackSetAgentSessionStatusApiResponse
    assertSlackApiSuccess(data, 'Failed to set Slack agent session status')
    const status = requireSlackAgentSessionStatus(data.status)
    const agentStatus = requireSlackAgentSessionStatus(data.agent_status)

    return {
      success: true,
      output: {
        ok: true,
        status,
        agentStatus,
        title: data.title ?? null,
      },
    }
  },
  outputs: {
    ok: { type: 'boolean', description: 'Whether Slack updated the agent session' },
    status: { type: 'string', description: 'Requested agent session status' },
    agentStatus: { type: 'string', description: 'Agent status recorded by Slack' },
    title: {
      type: 'string',
      description: 'Current agent session title, or null when the session has no title',
      nullable: true,
    },
  },
}
