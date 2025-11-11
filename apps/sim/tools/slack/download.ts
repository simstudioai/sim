import { createLogger } from '@/lib/logs/console/logger'
import type { SlackDownloadParams, SlackDownloadResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SlackDownloadTool')

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
      visibility: 'user-only',
      description: 'The ID of the file to download',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional filename override',
    },
  },

  request: {
    url: (params) => `https://slack.com/api/files.info?file=${params.fileId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: SlackDownloadParams) => {
    try {
      if (!response.ok) {
        const errorDetails = await response.json().catch(() => ({}))
        logger.error('Failed to get file info from Slack', {
          status: response.status,
          statusText: response.statusText,
          error: errorDetails,
        })
        throw new Error(errorDetails.error || 'Failed to get file info')
      }

      const data = await response.json()

      if (!data.ok) {
        logger.error('Slack API returned error', {
          error: data.error,
        })
        throw new Error(data.error || 'Slack API error')
      }

      const file = data.file
      const fileId = file.id
      const fileName = file.name
      const mimeType = file.mimetype || 'application/octet-stream'
      const urlPrivate = file.url_private
      const authToken = params?.accessToken || params?.botToken || ''

      if (!urlPrivate) {
        throw new Error('File does not have a download URL')
      }

      logger.info('Downloading file from Slack', {
        fileId,
        fileName,
        mimeType,
      })

      const downloadResponse = await fetch(urlPrivate, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })

      if (!downloadResponse.ok) {
        logger.error('Failed to download file content', {
          status: downloadResponse.status,
          statusText: downloadResponse.statusText,
        })
        throw new Error('Failed to download file content')
      }

      const arrayBuffer = await downloadResponse.arrayBuffer()
      const fileBuffer = Buffer.from(arrayBuffer)

      const resolvedName = params?.fileName || fileName || 'download'

      logger.info('File downloaded successfully', {
        fileId,
        name: resolvedName,
        size: fileBuffer.length,
        mimeType,
      })

      // Convert buffer to base64 string for proper JSON serialization
      // This ensures the file data survives the proxy round-trip
      const base64Data = fileBuffer.toString('base64')

      return {
        success: true,
        output: {
          file: {
            name: resolvedName,
            mimeType,
            data: base64Data,
            size: fileBuffer.length,
          },
        },
      }
    } catch (error: any) {
      logger.error('Error in transform response', {
        error: error.message,
        stack: error.stack,
      })
      throw error
    }
  },

  outputs: {
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
  },
}
