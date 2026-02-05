import type {
  GrafanaListAlertRulesParams,
  GrafanaListAlertRulesResponse,
} from '@/tools/grafana/types'
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
          ? data.map((rule: any) => ({
              uid: rule.uid,
              title: rule.title,
              condition: rule.condition,
              data: rule.data,
              updated: rule.updated,
              noDataState: rule.noDataState,
              execErrState: rule.execErrState,
              for: rule.for,
              annotations: rule.annotations || {},
              labels: rule.labels || {},
              isPaused: rule.isPaused || false,
              folderUID: rule.folderUID,
              ruleGroup: rule.ruleGroup,
              orgId: rule.orgId,
              namespace_uid: rule.namespace_uid,
              namespace_id: rule.namespace_id,
              provenance: rule.provenance || '',
            }))
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
        properties: {
          uid: { type: 'string', description: 'Alert rule UID' },
          title: { type: 'string', description: 'Alert rule title' },
          condition: { type: 'string', description: 'Alert condition' },
          folderUID: { type: 'string', description: 'Parent folder UID' },
          ruleGroup: { type: 'string', description: 'Rule group name' },
          noDataState: { type: 'string', description: 'State when no data is returned' },
          execErrState: { type: 'string', description: 'State on execution error' },
        },
      },
    },
  },
}
