import {
  ALERT_RULE_OUTPUT_FIELDS,
  type GrafanaGetAlertRuleGroupParams,
  type GrafanaGetAlertRuleGroupResponse,
} from '@/tools/grafana/types'
import { mapAlertRule } from '@/tools/grafana/utils'
import type { ToolConfig } from '@/tools/types'

export const getAlertRuleGroupTool: ToolConfig<
  GrafanaGetAlertRuleGroupParams,
  GrafanaGetAlertRuleGroupResponse
> = {
  id: 'grafana_get_alert_rule_group',
  name: 'Grafana Get Alert Rule Group',
  description:
    'Read an alert rule group: its evaluation interval and every rule in it. The interval is the group-level knob that decides how often those rules are evaluated, which the individual alert rule operations do not expose.',
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
    folderUid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'UID of the folder holding the rule group',
    },
    ruleGroup: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the rule group',
    },
  },

  request: {
    url: (params) =>
      `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/folder/${encodeURIComponent(
        params.folderUid.trim()
      )}/rule-groups/${encodeURIComponent(params.ruleGroup.trim())}`,
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
    const rules = Array.isArray(data.rules) ? (data.rules as Record<string, unknown>[]) : []

    return {
      success: true,
      output: {
        /** The group name; this endpoint carries it as `title`, not `name`. */
        title: (data.title as string) ?? null,
        folderUid: (data.folderUid as string) ?? null,
        interval: (data.interval as number) ?? null,
        rules: rules.map(mapAlertRule),
      },
    }
  },

  outputs: {
    title: { type: 'string', description: 'Name of the rule group', nullable: true },
    folderUid: {
      type: 'string',
      description: 'UID of the folder holding the group',
      nullable: true,
    },
    interval: {
      type: 'number',
      description:
        'How often the group is evaluated, as an integer. Grafana returns seconds here rather than a duration string',
      nullable: true,
    },
    rules: {
      type: 'array',
      description: 'Provisioned alert rules in the group',
      items: { type: 'object', properties: ALERT_RULE_OUTPUT_FIELDS },
    },
  },
}
