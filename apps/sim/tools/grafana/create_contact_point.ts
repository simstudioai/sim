import type {
  GrafanaCreateContactPointParams,
  GrafanaCreateContactPointResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const createContactPointTool: ToolConfig<
  GrafanaCreateContactPointParams,
  GrafanaCreateContactPointResponse
> = {
  id: 'grafana_create_contact_point',
  name: 'Grafana Create Contact Point',
  description: 'Create a notification contact point (e.g., Slack, email, PagerDuty)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grafana Service Account Token',
    },
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grafana instance URL (e.g., https://your-grafana.com)',
    },
    organizationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization ID for multi-org Grafana instances (e.g., 1, 2)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the contact point (groups receivers shown in the UI)',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Receiver type (e.g., slack, email, pagerduty, webhook)',
    },
    settings: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object of type-specific settings (e.g., {"addresses":"a@b.com"} for email, {"url":"..."} for slack)',
    },
    disableResolveMessage: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Do not send a notification when the alert resolves',
    },
    disableProvenance: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Set X-Disable-Provenance header so the contact point remains editable in the UI',
    },
  },

  request: {
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/contact-points`,
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
      if (params.organizationId) {
        headers['X-Grafana-Org-Id'] = params.organizationId
      }
      if (params.disableProvenance) {
        headers['X-Disable-Provenance'] = 'true'
      }
      return headers
    },
    body: (params) => {
      let settings: Record<string, unknown> = {}
      try {
        settings = JSON.parse(params.settings)
      } catch {
        throw new Error('Invalid JSON for settings parameter')
      }

      const body: Record<string, unknown> = {
        name: params.name,
        type: params.type,
        settings,
      }
      if (params.disableResolveMessage !== undefined) {
        body.disableResolveMessage = params.disableResolveMessage
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        uid: (data.uid as string) ?? '',
        name: (data.name as string) ?? '',
        type: (data.type as string) ?? '',
        settings: (data.settings as Record<string, unknown>) ?? {},
        disableResolveMessage: (data.disableResolveMessage as boolean) ?? false,
        provenance: (data.provenance as string) ?? '',
      },
    }
  },

  outputs: {
    uid: { type: 'string', description: 'UID of the created contact point' },
    name: { type: 'string', description: 'Name of the contact point' },
    type: { type: 'string', description: 'Receiver type' },
    settings: { type: 'json', description: 'Type-specific settings' },
    disableResolveMessage: {
      type: 'boolean',
      description: 'Whether resolve notifications are suppressed',
    },
    provenance: { type: 'string', description: 'Provisioning source (empty if API-managed)' },
  },
}
