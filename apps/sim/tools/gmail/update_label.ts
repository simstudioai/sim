import { GMAIL_API_BASE } from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Tool-only (not exposed in the Gmail block UI). Mirrors the existing
 * `gmail_create_label_v2` / `gmail_delete_label_v2` / `gmail_list_labels_v2`
 * pattern — these are programmatic/agent-facing tools used by Mothership
 * and MCP, not visual workflow operations.
 */

interface GmailUpdateLabelParams {
  accessToken: string
  labelId: string
  name?: string
  messageListVisibility?: string
  labelListVisibility?: string
}

interface GmailUpdateLabelResponse {
  success: boolean
  output: {
    id: string
    name?: string
    messageListVisibility?: string | null
    labelListVisibility?: string | null
    type?: string | null
  }
}

export const gmailUpdateLabelV2Tool: ToolConfig<GmailUpdateLabelParams, GmailUpdateLabelResponse> =
  {
    id: 'gmail_update_label_v2',
    name: 'Gmail Update Label',
    description:
      'Update a Gmail label in place (rename or change visibility) without recreating it',
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
        description: 'ID of the label to update (from Gmail List Labels)',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New display name for the label',
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
      url: (params: GmailUpdateLabelParams) =>
        `${GMAIL_API_BASE}/labels/${encodeURIComponent(params.labelId.trim())}`,
      method: 'PATCH',
      headers: (params: GmailUpdateLabelParams) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: (params: GmailUpdateLabelParams) => {
        const body: Record<string, string> = {}
        if (params.name) body.name = params.name
        if (params.messageListVisibility) {
          body.messageListVisibility = params.messageListVisibility
        }
        if (params.labelListVisibility) {
          body.labelListVisibility = params.labelListVisibility
        }
        return body
      },
    },

    transformResponse: async (response: Response, params?: GmailUpdateLabelParams) => {
      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: { id: params?.labelId ?? '' },
          error: data.error?.message || 'Failed to update label',
        }
      }

      return {
        success: true,
        output: {
          id: data.id,
          name: data.name ?? null,
          messageListVisibility: data.messageListVisibility ?? null,
          labelListVisibility: data.labelListVisibility ?? null,
          type: data.type ?? null,
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Label ID' },
      name: { type: 'string', description: 'Label display name', optional: true },
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
