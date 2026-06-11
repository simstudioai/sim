import type { SlackGetThreadFilesParams, SlackGetThreadFilesResponse } from '@/tools/slack/types'
import { FILE_DOWNLOAD_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackGetThreadFilesTool: ToolConfig<
  SlackGetThreadFilesParams,
  SlackGetThreadFilesResponse
> = {
  id: 'slack_get_thread_files',
  name: 'Slack Get Thread Files',
  description:
    'Download every file attached anywhere in a Slack thread in one step — the parent message and all replies. Optionally only files from messages after a given timestamp.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'slack',
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
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Slack channel ID containing the thread (e.g., C1234567890)',
    },
    threadTs: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Thread timestamp (thread_ts) of the parent message (e.g., 1405894322.002768)',
    },
    oldest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only include files from messages after this Unix timestamp (seconds). Leave empty for the whole thread',
    },
  },

  request: {
    url: '/api/tools/slack/thread-files',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken || params.botToken,
      channel: params.channel,
      threadTs: params.threadTs,
      oldest: params.oldest,
    }),
  },

  outputs: {
    files: {
      type: 'file[]',
      description:
        'Files downloaded from the thread (capped at 15 files, 50 MB each), stored in execution files',
      items: {
        type: 'object',
        properties: FILE_DOWNLOAD_OUTPUT_PROPERTIES,
      },
    },
    fileCount: {
      type: 'number',
      description: 'Number of files downloaded',
    },
    scannedMessages: {
      type: 'number',
      description: 'Number of thread messages scanned for files',
    },
    truncated: {
      type: 'boolean',
      description: 'True when the thread had more files or pages than the per-call limits allowed',
    },
  },
}
