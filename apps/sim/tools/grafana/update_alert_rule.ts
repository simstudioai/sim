import { ALERT_RULE_OUTPUT_FIELDS, type GrafanaUpdateAlertRuleParams } from '@/tools/grafana/types'
import { mapAlertRule } from '@/tools/grafana/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

// Using ToolResponse for intermediate state since this tool fetches existing data first
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
    // First, GET the existing alert rule
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
    // Store the existing rule data for postProcess to use
    const data = await response.json()
    return {
      success: true,
      output: {
        _existingRule: data,
      },
    }
  },

  postProcess: async (result, params) => {
    // Merge user changes with existing rule and PUT the complete object
    const existingRule = result.output._existingRule

    if (!existingRule || !existingRule.uid) {
      return {
        success: false,
        output: {},
        error: 'Failed to fetch existing alert rule',
      }
    }

    // Build the updated rule by merging existing data with new params
    const updatedRule: Record<string, unknown> = {
      ...existingRule,
    }

    // Apply user's changes
    if (params.title) updatedRule.title = params.title
    if (params.folderUid) updatedRule.folderUID = params.folderUid
    if (params.ruleGroup) updatedRule.ruleGroup = params.ruleGroup
    if (params.condition) updatedRule.condition = params.condition
    if (params.forDuration) updatedRule.for = params.forDuration
    if (params.noDataState) updatedRule.noDataState = params.noDataState
    if (params.execErrState) updatedRule.execErrState = params.execErrState
    if (params.isPaused !== undefined) updatedRule.isPaused = params.isPaused
    if (params.keepFiringFor) updatedRule.keep_firing_for = params.keepFiringFor
    if (params.missingSeriesEvalsToResolve !== undefined) {
      updatedRule.missingSeriesEvalsToResolve = params.missingSeriesEvalsToResolve
    }

    if (params.notificationSettings) {
      try {
        updatedRule.notification_settings = JSON.parse(params.notificationSettings)
      } catch {
        return {
          success: false,
          output: {},
          error: 'Invalid JSON for notificationSettings parameter',
        }
      }
    }

    if (params.record) {
      try {
        updatedRule.record = JSON.parse(params.record)
      } catch {
        return {
          success: false,
          output: {},
          error: 'Invalid JSON for record parameter',
        }
      }
    }

    if (params.data) {
      try {
        updatedRule.data = JSON.parse(params.data)
      } catch {
        return {
          success: false,
          output: {},
          error: 'Invalid JSON for data parameter',
        }
      }
    }

    if (params.annotations) {
      try {
        updatedRule.annotations = {
          ...(existingRule.annotations || {}),
          ...JSON.parse(params.annotations),
        }
      } catch {
        return {
          success: false,
          output: {},
          error: 'Invalid JSON for annotations parameter',
        }
      }
    }

    if (params.labels) {
      try {
        updatedRule.labels = {
          ...(existingRule.labels || {}),
          ...JSON.parse(params.labels),
        }
      } catch {
        return {
          success: false,
          output: {},
          error: 'Invalid JSON for labels parameter',
        }
      }
    }

    // Make the PUT request with the complete merged object
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

    const updateResponse = await fetch(
      `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/alert-rules/${params.alertRuleUid}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify(updatedRule),
      }
    )

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      return {
        success: false,
        output: {},
        error: `Failed to update alert rule: ${errorText}`,
      }
    }

    const data = await updateResponse.json()
    return { success: true, output: mapAlertRule(data) }
  },

  outputs: ALERT_RULE_OUTPUT_FIELDS,
}
