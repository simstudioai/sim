import type { RootlyAlertActionResponse, RootlyEscalateAlertParams } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyEscalateAlertTool: ToolConfig<
  RootlyEscalateAlertParams,
  RootlyAlertActionResponse
> = {
  id: 'rootly_escalate_alert',
  name: 'Rootly Escalate Alert',
  description: 'Escalate a Rootly alert, optionally to a specific escalation policy or level.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rootly API key',
    },
    alertId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the alert to escalate',
    },
    escalationPolicyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Escalation policy ID to escalate to (use List Escalation Policies to find IDs)',
    },
    escalationPolicyLevel: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Escalation policy level to escalate to',
    },
  },

  request: {
    url: (params) => `https://api.rootly.com/v1/alerts/${params.alertId.trim()}/escalate`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const attributes: Record<string, unknown> = {}
      if (params.escalationPolicyId)
        attributes.escalation_policy_id = params.escalationPolicyId.trim()
      if (params.escalationPolicyLevel !== undefined)
        attributes.escalation_policy_level = params.escalationPolicyLevel
      if (Object.keys(attributes).length === 0) return { data: {} }
      return { data: { type: 'alerts', attributes } }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { alert: {} as RootlyAlertActionResponse['output']['alert'] },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const attrs = data.data?.attributes || {}
    return {
      success: true,
      output: {
        alert: {
          id: data.data?.id ?? null,
          shortId: attrs.short_id ?? null,
          summary: attrs.summary ?? '',
          description: attrs.description ?? null,
          source: attrs.source ?? null,
          status: attrs.status ?? null,
          externalId: attrs.external_id ?? null,
          externalUrl: attrs.external_url ?? null,
          deduplicationKey: attrs.deduplication_key ?? null,
          createdAt: attrs.created_at ?? '',
          updatedAt: attrs.updated_at ?? '',
          startedAt: attrs.started_at ?? null,
          endedAt: attrs.ended_at ?? null,
        },
      },
    }
  },

  outputs: {
    alert: {
      type: 'object',
      description: 'The escalated alert',
      properties: {
        id: { type: 'string', description: 'Unique alert ID' },
        shortId: { type: 'string', description: 'Short alert ID' },
        summary: { type: 'string', description: 'Alert summary' },
        description: { type: 'string', description: 'Alert description' },
        source: { type: 'string', description: 'Alert source' },
        status: { type: 'string', description: 'Alert status' },
        externalId: { type: 'string', description: 'External ID' },
        externalUrl: { type: 'string', description: 'External URL' },
        deduplicationKey: { type: 'string', description: 'Deduplication key' },
        createdAt: { type: 'string', description: 'Creation date' },
        updatedAt: { type: 'string', description: 'Last update date' },
        startedAt: { type: 'string', description: 'Start date' },
        endedAt: { type: 'string', description: 'End date' },
      },
    },
  },
}
