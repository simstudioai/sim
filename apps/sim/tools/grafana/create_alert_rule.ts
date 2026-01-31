import type {
  GrafanaCreateAlertRuleParams,
  GrafanaCreateAlertRuleResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const createAlertRuleTool: ToolConfig<
  GrafanaCreateAlertRuleParams,
  GrafanaCreateAlertRuleResponse
> = {
  id: 'grafana_create_alert_rule',
  name: 'Grafana Create Alert Rule',
  description: 'Create a new alert rule',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the alert rule',
    },
    folderUid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UID of the folder to create the alert in (e.g., folder-abc123)',
    },
    ruleGroup: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the rule group',
    },
    condition: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The refId of the query or expression to use as the alert condition',
    },
    data: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of query/expression data objects',
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
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/alert-rules`,
    method: 'POST',
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
      let dataArray: any[] = []
      try {
        dataArray = JSON.parse(params.data)
      } catch {
        throw new Error('Invalid JSON for data parameter')
      }

      const body: Record<string, any> = {
        title: params.title,
        folderUID: params.folderUid,
        ruleGroup: params.ruleGroup,
        condition: params.condition,
        data: dataArray,
        for: params.forDuration || '5m',
        noDataState: params.noDataState || 'NoData',
        execErrState: params.execErrState || 'Alerting',
      }

      if (params.annotations) {
        try {
          body.annotations = JSON.parse(params.annotations)
        } catch {
          body.annotations = {}
        }
      }

      if (params.labels) {
        try {
          body.labels = JSON.parse(params.labels)
        } catch {
          body.labels = {}
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
      description: 'The UID of the created alert rule',
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
