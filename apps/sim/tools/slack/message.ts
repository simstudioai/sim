import { dryRunId } from '@/tools/dry-run'
import type { SlackMessageParams, SlackMessageResponse } from '@/tools/slack/types'
import { MESSAGE_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { InternalToolConfig } from '@/tools/types'

export const slackMessageTool: InternalToolConfig<SlackMessageParams, SlackMessageResponse> = {
  id: 'slack_message',
  name: 'Slack Message',
  description:
    'Send messages to Slack channels or direct messages. Supports Slack mrkdwn formatting.',
  version: '1.0.0',
  effect: 'write',
  assistant: {
    version: 1,
    reviewFields: [
      { name: 'channel', label: 'Channel', target: true },
      { name: 'dmUserId', label: 'Recipient', target: true },
      { name: 'threadTs', label: 'Thread', target: true },
      { name: 'text', label: 'Text (fallback for blocks)', format: 'multiline', editable: true },
      { name: 'blocks', label: 'Message blocks', format: 'json' },
    ],
  },

  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['chat:write'],
  },

  params: {
    authMethod: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Authentication method: oauth or bot_token',
    },
    destinationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Destination type: channel or dm',
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
    channel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Slack channel ID (e.g., C1234567890)',
    },
    dmUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Slack user ID for direct messages (e.g., U1234567890)',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message text to send (supports Slack mrkdwn formatting)',
    },
    threadTs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Thread timestamp to reply to (creates thread reply)',
    },
    blocks: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Block Kit layout blocks as a JSON array. When provided, text becomes the fallback notification text.',
    },
    files: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to attach to the message',
    },
  },

  operation: {
    input: (params: SlackMessageParams) => {
      const isDM = params.destinationType === 'dm'
      return {
        accessToken: params.accessToken || params.botToken,
        channel: isDM ? undefined : params.channel?.trim(),
        userId: isDM ? params.dmUserId?.trim() : undefined,
        text: params.text,
        thread_ts: params.threadTs?.trim() || undefined,
        blocks:
          typeof params.blocks === 'string'
            ? JSON.parse(params.blocks)
            : params.blocks || undefined,
        files: params.files || null,
      }
    },
  },

  /**
   * A dry run's placeholder holds the text the call sends, unless it holds `&`, `<` or `>`, which
   * Slack returns escaped or as links; the thread it replies in (which a message with files does
   * not report); and how many files it attaches. The channel and timestamp stay placeholders (a
   * DM's channel is the one Slack opens), each one value wherever the output repeats it.
   */
  dryRunOutput: (params) => {
    const threadTs = params.threadTs?.trim()
    const fileCount = params.files?.length ?? 0
    const ts = dryRunId('ts')
    const channel = dryRunId('channel')
    return {
      ts,
      channel,
      message: {
        ts,
        channel,
        ...(/[&<>]/.test(params.text) ? {} : { text: params.text }),
        ...(threadTs && fileCount === 0 ? { thread_ts: threadTs } : {}),
      },
      ...(fileCount > 0 ? { fileCount } : {}),
    }
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to send Slack message')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    message: {
      type: 'object',
      description: 'Complete message object with all properties returned by Slack',
      properties: MESSAGE_OUTPUT_PROPERTIES,
    },
    // Legacy properties for backward compatibility
    ts: { type: 'string', description: 'Message timestamp' },
    channel: { type: 'string', description: 'Channel ID where message was sent' },
    fileCount: {
      type: 'number',
      description: 'Number of files uploaded (when files are attached)',
    },
    files: { type: 'file[]', description: 'Files attached to the message' },
  },
}
