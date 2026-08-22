import type {
  IncidentioEscalationsCancelParams,
  IncidentioEscalationsCancelResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const escalationsCancelTool: ToolConfig<
  IncidentioEscalationsCancelParams,
  IncidentioEscalationsCancelResponse
> = {
  id: 'incidentio_escalations_cancel',
  name: 'Cancel Escalation',
  description:
    'Cancel an escalation in incident.io. Notifications stop, and the escalation will not advance to further levels or repeat.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the escalation to cancel (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) =>
      `https://api.incident.io/v2/escalations/${encodeURIComponent(params.id.trim())}/actions/cancel`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async () => {
    return {
      success: true,
      output: {
        message: 'Escalation cancelled successfully',
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Success message',
    },
  },
}
