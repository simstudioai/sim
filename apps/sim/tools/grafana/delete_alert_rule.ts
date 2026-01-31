import type {
  GrafanaDeleteAlertRuleParams,
  GrafanaDeleteAlertRuleResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const deleteAlertRuleTool: ToolConfig<
  GrafanaDeleteAlertRuleParams,
  GrafanaDeleteAlertRuleResponse
> = {
  id: 'grafana_delete_alert_rule',
  name: 'Grafana Delete Alert Rule',
  description: 'Delete an alert rule by its UID',
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
    alertRuleUid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UID of the alert rule to delete',
    },
  },

  request: {
    url: (params) =>
      `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/alert-rules/${params.alertRuleUid}`,
    method: 'DELETE',
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

  transformResponse: async () => {
    return {
      success: true,
      output: {
        message: 'Alert rule deleted successfully',
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Confirmation message',
    },
  },
}
