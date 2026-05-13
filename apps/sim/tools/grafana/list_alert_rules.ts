import {
  ALERT_RULE_OUTPUT_FIELDS,
  type GrafanaListAlertRulesParams,
  type GrafanaListAlertRulesResponse,
} from '@/tools/grafana/types'
import { mapAlertRule } from '@/tools/grafana/utils'
import type { ToolConfig } from '@/tools/types'

export const listAlertRulesTool: ToolConfig<
  GrafanaListAlertRulesParams,
  GrafanaListAlertRulesResponse
> = {
  id: 'grafana_list_alert_rules',
  name: 'Grafana List Alert Rules',
  description: 'List all alert rules in the Grafana instance',
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
  },

  request: {
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/alert-rules`,
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

    return {
      success: true,
      output: {
        rules: Array.isArray(data)
          ? data.map((rule: Record<string, unknown>) => mapAlertRule(rule))
          : [],
      },
    }
  },

  outputs: {
    rules: {
      type: 'array',
      description: 'List of alert rules',
      items: {
        type: 'object',
        properties: ALERT_RULE_OUTPUT_FIELDS,
      },
    },
  },
}
