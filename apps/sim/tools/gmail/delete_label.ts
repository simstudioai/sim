import { GMAIL_API_BASE } from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

interface GmailDeleteLabelParams {
  accessToken: string
  labelId: string
}

interface GmailDeleteLabelResponse {
  success: boolean
  output: {
    deleted: boolean
    labelId: string
  }
}

export const gmailDeleteLabelV2Tool: ToolConfig<GmailDeleteLabelParams, GmailDeleteLabelResponse> =
  {
    id: 'gmail_delete_label_v2',
    name: 'Gmail Delete Label',
    description: 'Delete a label from Gmail',
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
      labelId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the label to delete',
      },
    },

    request: {
      url: (params: GmailDeleteLabelParams) => `${GMAIL_API_BASE}/labels/${params.labelId}`,
      method: 'DELETE',
      headers: (params: GmailDeleteLabelParams) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response, params?: GmailDeleteLabelParams) => {
      if (!response.ok) {
        const data = await response.json()
        return {
          success: false,
          output: { deleted: false, labelId: params?.labelId ?? '' },
          error: data.error?.message || 'Failed to delete label',
        }
      }

      return {
        success: true,
        output: {
          deleted: true,
          labelId: params?.labelId ?? '',
        },
      }
    },

    outputs: {
      deleted: { type: 'boolean', description: 'Whether the label was successfully deleted' },
      labelId: { type: 'string', description: 'ID of the deleted label' },
    },
  }
