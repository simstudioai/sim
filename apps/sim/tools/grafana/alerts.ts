import type {
  GrafanaCreateAlertRuleParams,
  GrafanaCreateAlertRuleResponse,
  GrafanaDeleteAlertRuleParams,
  GrafanaDeleteAlertRuleResponse,
  GrafanaGetAlertRuleParams,
  GrafanaGetAlertRuleResponse,
  GrafanaListAlertRulesParams,
  GrafanaListAlertRulesResponse,
  GrafanaListContactPointsParams,
  GrafanaListContactPointsResponse,
  GrafanaUpdateAlertRuleParams,
  GrafanaUpdateAlertRuleResponse,
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
      visibility: 'user-only',
      description: 'Organization ID for multi-org Grafana instances',
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
        visibility: 'user-only',
        description: 'Organization ID for multi-org Grafana instances',
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
      visibility: 'user-only',
      description: 'Organization ID for multi-org Grafana instances',
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
      description: 'The UID of the folder to create the alert in',
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

export const deleteAlertRuleTool: ToolConfig<
  GrafanaDeleteAlertRuleParams,
  GrafanaDeleteAlertRuleResponse
> = {
  id: 'grafana_delete_alert_rule',
  name: 'Grafana Delete Alert Rule',
  description: 'Delete an alert rule by its UID',
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
      description: 'The UID of the alert rule to delete',
    },
  },

  request: {
    url: (params) =>
      `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/alert-rules/${params.alertRuleUid}`,
    method: 'DELETE',
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

  transformResponse: async () => {
    return {
      success: true,
      output: {
        message: 'Alert rule deleted successfully',
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Confirmation message',
    },
  },
}

export const listContactPointsTool: ToolConfig<
  GrafanaListContactPointsParams,
  GrafanaListContactPointsResponse
> = {
  id: 'grafana_list_contact_points',
  name: 'Grafana List Contact Points',
  description: 'List all alert notification contact points',
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
  },

  request: {
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/contact-points`,
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
        contactPoints: Array.isArray(data)
          ? data.map((cp: any) => ({
              uid: cp.uid,
              name: cp.name,
              type: cp.type,
              settings: cp.settings || {},
              disableResolveMessage: cp.disableResolveMessage || false,
              provenance: cp.provenance || '',
            }))
          : [],
      },
    }
  },

  outputs: {
    contactPoints: {
      type: 'array',
      description: 'List of contact points',
      items: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Contact point UID' },
          name: { type: 'string', description: 'Contact point name' },
          type: { type: 'string', description: 'Notification type (email, slack, etc.)' },
          settings: { type: 'object', description: 'Type-specific settings' },
        },
      },
    },
  },
}
