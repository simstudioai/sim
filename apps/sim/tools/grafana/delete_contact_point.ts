import type {
  GrafanaDeleteContactPointParams,
  GrafanaDeleteContactPointResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const deleteContactPointTool: ToolConfig<
  GrafanaDeleteContactPointParams,
  GrafanaDeleteContactPointResponse
> = {
  id: 'grafana_delete_contact_point',
  name: 'Grafana Delete Contact Point',
  description:
    'Permanently delete a contact point by its UID. Grafana refuses the delete while the contact point is still referenced by the notification policy tree or by an alert rule.',
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
      description: 'UID of the contact point to delete',
    },
  },

  request: {
    url: (params) =>
      `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/contact-points/${encodeURIComponent(
        params.contactPointUid.trim()
      )}`,
    method: 'DELETE',
    /**
     * No X-Disable-Provenance here. The delete handler never reads stored
     * provenance, so an API-provisioned contact point deletes without it — and
     * the endpoint accepts no such parameter.
     */
    headers: (params) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
      if (params.organizationId) {
        headers['X-Grafana-Org-Id'] = params.organizationId
      }
      return headers
    },
  },

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
      description: 'The UID that was deleted, echoed from the request',
      nullable: true,
    },
    message: {
      type: 'string',
      description: 'Confirmation message from Grafana, e.g. "contactpoint deleted"',
      nullable: true,
    },
  },
}
