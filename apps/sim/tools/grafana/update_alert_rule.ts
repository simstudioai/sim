import type { GrafanaUpdateAlertRuleParams } from '@/tools/grafana/types'
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
    const updatedRule: Record<string, any> = {
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

    if (params.data) {
      try {
        updatedRule.data = JSON.parse(params.data)
      } catch {
        // Keep existing data if parse fails
      }
    }

    if (params.annotations) {
      try {
        updatedRule.annotations = {
          ...(existingRule.annotations || {}),
          ...JSON.parse(params.annotations),
        }
      } catch {
        // Keep existing annotations if parse fails
      }
    }

    if (params.labels) {
      try {
        updatedRule.labels = {
          ...(existingRule.labels || {}),
          ...JSON.parse(params.labels),
        }
      } catch {
        // Keep existing labels if parse fails
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
