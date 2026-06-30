import { ALERT_RULE_OUTPUT_FIELDS, type GrafanaUpdateAlertRuleParams } from '@/tools/grafana/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const updateAlertRuleTool: ToolConfig<GrafanaUpdateAlertRuleParams, ToolResponse> = {
  id: 'grafana_update_alert_rule',
  name: 'Grafana Update Alert Rule',
  description: 'Update an existing alert rule. Fetches the current rule and merges your changes.',
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
      description: 'New folder UID to move the alert to (e.g., folder-abc123)',
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
    isPaused: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether the rule is paused',
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
      description: 'JSON object configuring this as a recording rule',
    },
    disableProvenance: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Set X-Disable-Provenance header so the rule remains editable in the Grafana UI',
    },
  },

  request: {
    url: () => '/api/tools/grafana/update_alert_rule',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      organizationId: params.organizationId,
      alertRuleUid: params.alertRuleUid,
      title: params.title,
      folderUid: params.folderUid,
      ruleGroup: params.ruleGroup,
      condition: params.condition,
      data: params.data,
      forDuration: params.forDuration,
      noDataState: params.noDataState,
      execErrState: params.execErrState,
      annotations: params.annotations,
      labels: params.labels,
      isPaused: params.isPaused,
      keepFiringFor: params.keepFiringFor,
      missingSeriesEvalsToResolve: params.missingSeriesEvalsToResolve,
      notificationSettings: params.notificationSettings,
      record: params.record,
      disableProvenance: params.disableProvenance,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: data.success ?? true,
      output: data.output ?? {},
      ...(data.error ? { error: data.error } : {}),
    }
  },

  outputs: ALERT_RULE_OUTPUT_FIELDS,
}
