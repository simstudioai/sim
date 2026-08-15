import { GMAIL_API_BASE } from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

interface GmailCreateLabelParams {
  accessToken: string
  name: string
  messageListVisibility?: string
  labelListVisibility?: string
}

interface GmailCreateLabelResponse {
  success: boolean
  output: {
    id: string
    name: string
    messageListVisibility?: string
    labelListVisibility?: string
    type?: string
  }
}

export const gmailCreateLabelV2Tool: ToolConfig<GmailCreateLabelParams, GmailCreateLabelResponse> =
  {
    id: 'gmail_create_label_v2',
    name: 'Gmail Create Label',
    description: 'Create a new label in Gmail',
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
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Display name for the new label',
      },
      messageListVisibility: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Visibility of messages with this label in the message list (show or hide)',
      },
      labelListVisibility: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Visibility of the label in the label list (labelShow, labelShowIfUnread, or labelHide)',
      },
    },

    request: {
      url: () => `${GMAIL_API_BASE}/labels`,
      method: 'POST',
      headers: (params: GmailCreateLabelParams) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: (params: GmailCreateLabelParams) => {
        const body: Record<string, string> = { name: params.name }
        if (params.messageListVisibility) {
          body.messageListVisibility = params.messageListVisibility
        }
        if (params.labelListVisibility) {
          body.labelListVisibility = params.labelListVisibility
        }
        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: { id: '', name: '' },
          error: data.error?.message || 'Failed to create label',
        }
      }

      return {
        success: true,
        output: {
          id: data.id,
          name: data.name,
          messageListVisibility: data.messageListVisibility ?? null,
          labelListVisibility: data.labelListVisibility ?? null,
          type: data.type ?? null,
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Label ID' },
      name: { type: 'string', description: 'Label display name' },
      messageListVisibility: {
        type: 'string',
        description: 'Visibility of messages with this label',
        optional: true,
      },
      labelListVisibility: {
        type: 'string',
        description: 'Visibility of the label in the label list',
        optional: true,
      },
      type: { type: 'string', description: 'Label type (system or user)', optional: true },
    },
  }
