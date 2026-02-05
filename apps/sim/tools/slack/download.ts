import type { SlackDownloadParams, SlackDownloadResponse } from '@/tools/slack/types'
import { FILE_DOWNLOAD_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackDownloadTool: ToolConfig<SlackDownloadParams, SlackDownloadResponse> = {
  id: 'slack_download',
  name: 'Download File from Slack',
  description: 'Download a file from Slack',
  version: '1.0',

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
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file to download',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional filename override',
    },
  },

  request: {
    url: '/api/tools/slack/download',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken || params.botToken,
      fileId: params.fileId,
      fileName: params.fileName,
    }),
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Downloaded file stored in execution files',
      properties: FILE_DOWNLOAD_OUTPUT_PROPERTIES,
    },
  },
}
