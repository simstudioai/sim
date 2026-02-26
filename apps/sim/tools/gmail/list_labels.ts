import { GMAIL_API_BASE } from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

interface GmailListLabelsParams {
  accessToken: string
}

interface GmailListLabelsResponse {
  success: boolean
  output: {
    labels: Array<{
      id: string
      name: string
      type: string
      messageListVisibility?: string
      labelListVisibility?: string
    }>
  }
}

export const gmailListLabelsV2Tool: ToolConfig<GmailListLabelsParams, GmailListLabelsResponse> = {
  id: 'gmail_list_labels_v2',
  name: 'Gmail List Labels',
  description: 'List all labels in a Gmail account',
  version: '2.0.0',

  oauth: {
    required: true,
    provider: 'google-email',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Gmail API',
    },
  },

  request: {
    url: () => `${GMAIL_API_BASE}/labels`,
    method: 'GET',
    headers: (params: GmailListLabelsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: { labels: [] },
        error: data.error?.message || 'Failed to list labels',
      }
    }

    const labels = (data.labels || []).map((label: Record<string, unknown>) => ({
      id: label.id,
      name: label.name,
      type: label.type ?? null,
      messageListVisibility: label.messageListVisibility ?? null,
      labelListVisibility: label.labelListVisibility ?? null,
    }))

    return {
      success: true,
      output: { labels },
    }
  },

  outputs: {
    labels: {
      type: 'json',
      description: 'Array of label objects with id, name, type, and visibility settings',
    },
  },
}
