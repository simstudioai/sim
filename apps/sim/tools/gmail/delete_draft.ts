import { GMAIL_API_BASE } from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

interface GmailDeleteDraftParams {
  accessToken: string
  draftId: string
}

interface GmailDeleteDraftResponse {
  success: boolean
  output: {
    deleted: boolean
    draftId: string
  }
}

export const gmailDeleteDraftV2Tool: ToolConfig<GmailDeleteDraftParams, GmailDeleteDraftResponse> =
  {
    id: 'gmail_delete_draft_v2',
    name: 'Gmail Delete Draft',
    description: 'Delete a specific draft from Gmail',
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
      draftId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the draft to delete',
      },
    },

    request: {
      url: (params: GmailDeleteDraftParams) => `${GMAIL_API_BASE}/drafts/${params.draftId}`,
      method: 'DELETE',
      headers: (params: GmailDeleteDraftParams) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response, params?: GmailDeleteDraftParams) => {
      if (!response.ok) {
        const data = await response.json()
        return {
          success: false,
          output: { deleted: false, draftId: params?.draftId ?? '' },
          error: data.error?.message || 'Failed to delete draft',
        }
      }

      return {
        success: true,
        output: {
          deleted: true,
          draftId: params?.draftId ?? '',
        },
      }
    },

    outputs: {
      deleted: { type: 'boolean', description: 'Whether the draft was successfully deleted' },
      draftId: { type: 'string', description: 'ID of the deleted draft' },
    },
  }
