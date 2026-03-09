import type { GrafanaGetAlertRuleParams, GrafanaGetAlertRuleResponse } from '@/tools/grafana/types'
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

      return {
        success: true,
        output: {
          uid: data.uid,
          title: data.title,
          condition: data.condition,
          data: data.data,
          updated: data.updated,
          noDataState: data.noDataState,
          execErrState: data.execErrState,
          for: data.for,
          annotations: data.annotations || {},
          labels: data.labels || {},
          isPaused: data.isPaused || false,
          folderUID: data.folderUID,
          ruleGroup: data.ruleGroup,
          orgId: data.orgId,
          namespace_uid: data.namespace_uid,
          namespace_id: data.namespace_id,
          provenance: data.provenance || '',
        },
      }
    },

    outputs: {
      uid: {
        type: 'string',
        description: 'Alert rule UID',
      },
      title: {
        type: 'string',
        description: 'Alert rule title',
      },
      condition: {
        type: 'string',
        description: 'Alert condition',
      },
      data: {
        type: 'json',
        description: 'Alert rule query data',
      },
      folderUID: {
        type: 'string',
        description: 'Parent folder UID',
      },
      ruleGroup: {
        type: 'string',
        description: 'Rule group name',
      },
      noDataState: {
        type: 'string',
        description: 'State when no data is returned',
      },
      execErrState: {
        type: 'string',
        description: 'State on execution error',
      },
      annotations: {
        type: 'json',
        description: 'Alert annotations',
      },
      labels: {
        type: 'json',
        description: 'Alert labels',
      },
    },
  }
