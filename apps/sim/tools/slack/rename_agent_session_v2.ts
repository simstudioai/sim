import type {
  SlackRenameAgentSessionV2Params,
  SlackRenameAgentSessionV2Response,
} from '@/tools/slack/types'
import {
  assertSlackApiSuccess,
  requireSlackString,
  resolveSlackAccessToken,
} from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

interface SlackRenameAgentSessionApiResponse {
  ok?: boolean
  error?: string
  title?: string
}

export const slackRenameAgentSessionV2Tool: ToolConfig<
  SlackRenameAgentSessionV2Params,
  SlackRenameAgentSessionV2Response
> = {
  id: 'slack_rename_agent_session_v2',
  name: 'Slack Rename Agent Session',
  description: 'Rename the Slack agent session associated with a thread.',
  version: '2.0.0',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['chat:write'],
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New agent session title, from 1 to 200 characters',
    },
  },
  request: {
    url: () => 'https://slack.com/api/agents.sessions.rename',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${resolveSlackAccessToken(params)}`,
    }),
    body: (params) => {
      const title = requireSlackString(params.title, 'Session Title')
      if (title.length > 200) throw new Error('Session Title must be 200 characters or fewer')
      return {
        channel_id: requireSlackString(params.channel, 'Channel'),
        thread_ts: requireSlackString(params.threadTs, 'Thread Timestamp'),
        title,
      }
    },
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as SlackRenameAgentSessionApiResponse
    assertSlackApiSuccess(data, 'Failed to rename Slack agent session')
    return {
      success: true,
      output: {
        ok: true,
        title: requireSlackString(data.title, 'Slack response title'),
      },
    }
  },
  outputs: {
    ok: { type: 'boolean', description: 'Whether Slack renamed the agent session' },
    title: { type: 'string', description: 'Updated agent session title' },
  },
}
