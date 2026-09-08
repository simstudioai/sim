import type {
  GrafanaUpdateContactPointParams,
  GrafanaUpdateContactPointResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const updateContactPointTool: ToolConfig<
  GrafanaUpdateContactPointParams,
  GrafanaUpdateContactPointResponse
> = {
  id: 'grafana_update_contact_point',
  name: 'Grafana Update Contact Point',
  description:
    'Replace a contact point by its UID. Grafana has no partial update for contact points, so every field is rewritten — resend the name, type, and full settings, or the omitted ones are reset.',
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
    contactPointUid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'UID of the contact point to replace',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contact point name. Grafana groups receivers that share a name',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Receiver type, e.g. slack, email, pagerduty, webhook, opsgenie, teams, discord, telegram',
    },
    settings: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object of receiver settings for this type, e.g. { "url": "https://hooks.slack.com/..." } for slack',
    },
    disableResolveMessage: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Suppress the resolved notification. Omitting this resets it to false',
    },
    disableProvenance: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Send X-Disable-Provenance. Use only on a contact point whose provenance is already empty (UI-created, or created by Sim with this on) — sending it against an API-provisioned contact point is rejected with 403',
    },
  },

  request: {
    url: (params) =>
      `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/contact-points/${encodeURIComponent(
        params.contactPointUid.trim()
      )}`,
    method: 'PUT',
    headers: (params) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
      if (params.organizationId) {
        headers['X-Grafana-Org-Id'] = params.organizationId
      }
      /** Grafana tests this header by presence, so it is only ever sent when wanted. */
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

      /**
       * The UID is taken from the path — Grafana overwrites any UID in the body —
       * so it is deliberately not sent.
       */
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

  /**
   * The update answers 202 with only a message — unlike create, which returns the
   * object — so the UID is echoed from the request.
   */
  transformResponse: async (response: Response, params) => {
    const data = (await response.json().catch(() => ({}))) as { message?: string }

    return {
      success: true,
      output: {
        uid: params?.contactPointUid?.trim() ?? null,
        message: data.message ?? null,
      },
    }
  },

  outputs: {
    uid: {
      type: 'string',
      description:
        'The UID that was updated, echoed from the request — Grafana answers a contact point update with only a message and returns no object',
      nullable: true,
    },
    message: {
      type: 'string',
      description: 'Confirmation message from Grafana, e.g. "contactpoint updated"',
      nullable: true,
    },
  },
}
