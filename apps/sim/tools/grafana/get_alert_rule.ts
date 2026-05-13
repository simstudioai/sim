import {
  ALERT_RULE_OUTPUT_FIELDS,
  type GrafanaGetAlertRuleParams,
  type GrafanaGetAlertRuleResponse,
} from '@/tools/grafana/types'
import { mapAlertRule } from '@/tools/grafana/utils'
import type { ToolConfig } from '@/tools/types'

export const getAlertRuleTool: ToolConfig<GrafanaGetAlertRuleParams, GrafanaGetAlertRuleResponse> =
  {
    id: 'grafana_get_alert_rule',
    name: 'Grafana Get Alert Rule',
    description: 'Get a specific alert rule by its UID',
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
        description: 'The UID of the alert rule to retrieve',
      },
    },

    request: {
      url: (params) =>
        `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/alert-rules/${params.alertRuleUid}`,
      method: 'GET',
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

    transformResponse: async (response: Response) => {
      const data = await response.json()
      return { success: true, output: mapAlertRule(data) }
    },

    outputs: ALERT_RULE_OUTPUT_FIELDS,
  }
