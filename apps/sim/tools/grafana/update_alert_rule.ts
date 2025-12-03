import type {
  GrafanaUpdateAlertRuleParams,
  GrafanaUpdateAlertRuleResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const updateAlertRuleTool: ToolConfig<
  GrafanaUpdateAlertRuleParams,
  GrafanaUpdateAlertRuleResponse
> = {
  id: 'grafana_update_alert_rule',
  name: 'Grafana Update Alert Rule',
  description: 'Update an existing alert rule',
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
      visibility: 'user-only',
      description: 'Organization ID for multi-org Grafana instances',
    },
    alertRuleUid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UID of the alert rule to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the alert rule',
    },
    folderUid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New folder UID to move the alert to',
    },
    ruleGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New rule group name',
    },
    condition: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New condition refId',
    },
    data: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New JSON array of query/expression data objects',
    },
    forDuration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration to wait before firing (e.g., 5m, 1h)',
    },
    noDataState: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'State when no data is returned (NoData, Alerting, OK)',
    },
    execErrState: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'State on execution error (Alerting, OK)',
    },
    annotations: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of annotations',
    },
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of labels',
    },
  },

  request: {
    url: (params) =>
      `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/alert-rules/${params.alertRuleUid}`,
    method: 'PUT',
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
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.title) body.title = params.title
      if (params.folderUid) body.folderUID = params.folderUid
      if (params.ruleGroup) body.ruleGroup = params.ruleGroup
      if (params.condition) body.condition = params.condition
      if (params.forDuration) body.for = params.forDuration
      if (params.noDataState) body.noDataState = params.noDataState
      if (params.execErrState) body.execErrState = params.execErrState

      if (params.data) {
        try {
          body.data = JSON.parse(params.data)
        } catch {
          // Skip if invalid JSON
        }
      }

      if (params.annotations) {
        try {
          body.annotations = JSON.parse(params.annotations)
        } catch {
          // Skip if invalid JSON
        }
      }

      if (params.labels) {
        try {
          body.labels = JSON.parse(params.labels)
        } catch {
          // Skip if invalid JSON
        }
      }

      return body
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
      description: 'The UID of the updated alert rule',
    },
    title: {
      type: 'string',
      description: 'Alert rule title',
    },
    folderUID: {
      type: 'string',
      description: 'Parent folder UID',
    },
    ruleGroup: {
      type: 'string',
      description: 'Rule group name',
    },
  },
}
