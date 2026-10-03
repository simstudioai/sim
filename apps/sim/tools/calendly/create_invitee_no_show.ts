import type {
  CalendlyCreateInviteeNoShowParams,
  CalendlyCreateInviteeNoShowResponse,
} from '@/tools/calendly/types'
import type { ToolConfig } from '@/tools/types'

export const createInviteeNoShowTool: ToolConfig<
  CalendlyCreateInviteeNoShowParams,
  CalendlyCreateInviteeNoShowResponse
> = {
  id: 'calendly_create_invitee_no_show',
  name: 'Calendly Mark Invitee No-Show',
  description: 'Mark an invitee of a scheduled event as a no-show',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    inviteeUri: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Full invitee URI to mark as a no-show. Format: URI (e.g., "https://api.calendly.com/scheduled_events/abc123/invitees/def456")',
    },
  },

  request: {
    url: () => 'https://api.calendly.com/invitee_no_shows',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: CalendlyCreateInviteeNoShowParams) => ({
      invitee: params.inviteeUri.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    resource: {
      type: 'object',
      description: 'The created no-show record',
      properties: {
        uri: { type: 'string', description: 'Canonical reference to the no-show' },
        invitee: { type: 'string', description: 'URI of the invitee marked as a no-show' },
        created_at: { type: 'string', description: 'ISO timestamp when the no-show was recorded' },
      },
    },
  },
}
