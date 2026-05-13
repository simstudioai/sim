import type {
  GrafanaCreateAlertRuleParams,
  GrafanaCreateAlertRuleResponse,
} from '@/tools/grafana/types'
import { ALERT_RULE_OUTPUT_FIELDS } from '@/tools/grafana/types'
import { mapAlertRule } from '@/tools/grafana/utils'
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'The refId of the query or expression to use as the alert condition (required for alerting rules; omit for recording rules)',
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
      description: 'State on execution error (Error, Alerting, OK)',
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
    uid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional custom UID for the alert rule',
    },
    isPaused: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether the rule is paused on creation',
    },
    keepFiringFor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration to keep firing after the condition stops (e.g., 5m)',
    },
    missingSeriesEvalsToResolve: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of missing series evaluations before resolving',
    },
    notificationSettings: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'JSON object of per-rule notification settings (overrides)',
    },
    record: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object configuring this as a recording rule (omit for alerting rules)',
    },
    disableProvenance: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Set X-Disable-Provenance header so the rule remains editable in the Grafana UI',
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
      if (params.disableProvenance) {
        headers['X-Disable-Provenance'] = 'true'
      }
      return headers
    },
    body: (params) => {
      let dataArray: unknown[] = []
      try {
        dataArray = JSON.parse(params.data)
      } catch {
        throw new Error('Invalid JSON for data parameter')
      }

      const body: Record<string, unknown> = {
        title: params.title,
        folderUID: params.folderUid,
        ruleGroup: params.ruleGroup,
        data: dataArray,
      }
      if (params.organizationId) body.orgID = Number(params.organizationId)

      if (params.condition) body.condition = params.condition
      if (params.uid) body.uid = params.uid
      if (params.forDuration) body.for = params.forDuration
      if (params.noDataState) body.noDataState = params.noDataState
      if (params.execErrState) body.execErrState = params.execErrState
      if (params.isPaused !== undefined) body.isPaused = params.isPaused
      if (params.keepFiringFor) body.keep_firing_for = params.keepFiringFor
      if (params.missingSeriesEvalsToResolve !== undefined) {
        body.missingSeriesEvalsToResolve = params.missingSeriesEvalsToResolve
      }

      if (params.annotations) {
        try {
          body.annotations = JSON.parse(params.annotations)
        } catch {
          throw new Error('Invalid JSON for annotations parameter')
        }
      }

      if (params.labels) {
        try {
          body.labels = JSON.parse(params.labels)
        } catch {
          throw new Error('Invalid JSON for labels parameter')
        }
      }

      if (params.notificationSettings) {
        try {
          body.notification_settings = JSON.parse(params.notificationSettings)
        } catch {
          throw new Error('Invalid JSON for notificationSettings parameter')
        }
      }

      if (params.record) {
        try {
          body.record = JSON.parse(params.record)
        } catch {
          throw new Error('Invalid JSON for record parameter')
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: mapAlertRule(data) }
  },

  outputs: ALERT_RULE_OUTPUT_FIELDS,
}
