import type {
  CalendlyDeleteInviteeNoShowParams,
  CalendlyDeleteInviteeNoShowResponse,
} from '@/tools/calendly/types'
import { toUuid } from '@/tools/calendly/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteInviteeNoShowTool: ToolConfig<
  CalendlyDeleteInviteeNoShowParams,
  CalendlyDeleteInviteeNoShowResponse
> = {
  id: 'calendly_delete_invitee_no_show',
  name: 'Calendly Unmark Invitee No-Show',
  description: 'Remove the no-show status from an invitee',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    noShowUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'No-show UUID to remove. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/invitee_no_shows/abc123-def456")',
    },
  },

  request: {
    url: (params: CalendlyDeleteInviteeNoShowParams) =>
      `https://api.calendly.com/invitee_no_shows/${toUuid(params.noShowUuid)}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (response.status === 204 || response.status === 200) {
      return {
        success: true,
        output: {
          deleted: true,
          message: 'No-show status removed successfully',
        },
      }
    }

    const data = await response.json()
    return {
      success: false,
      output: {
        deleted: false,
        message: data.message || 'Failed to remove no-show status',
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the no-show status was successfully removed',
    },
    message: {
      type: 'string',
      description: 'Status message',
    },
  },
}
