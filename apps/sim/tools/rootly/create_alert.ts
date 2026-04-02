import type { RootlyCreateAlertParams, RootlyCreateAlertResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyCreateAlertTool: ToolConfig<RootlyCreateAlertParams, RootlyCreateAlertResponse> =
  {
    id: 'rootly_create_alert',
    name: 'Rootly Create Alert',
    description: 'Create a new alert in Rootly for on-call notification and routing.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Rootly API key',
      },
      summary: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The summary of the alert',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'A detailed description of the alert',
      },
      source: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The source of the alert (e.g., api, manual, datadog, pagerduty)',
      },
      status: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Alert status on creation (open, triggered)',
      },
      serviceIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated service IDs to attach',
      },
      groupIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated team/group IDs to attach',
      },
      environmentIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated environment IDs to attach',
      },
      externalId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'External ID for the alert',
      },
      externalUrl: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'External URL for the alert',
      },
      deduplicationKey: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Alerts sharing the same deduplication key are treated as a single alert',
      },
    },

    request: {
      url: 'https://api.rootly.com/v1/alerts',
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const attributes: Record<string, unknown> = {
          summary: params.summary,
          source: params.source,
        }
        if (params.description) attributes.description = params.description
        if (params.status) attributes.status = params.status
        if (params.externalId) attributes.external_id = params.externalId
        if (params.externalUrl) attributes.external_url = params.externalUrl
        if (params.deduplicationKey) attributes.deduplication_key = params.deduplicationKey
        if (params.serviceIds) {
          attributes.service_ids = params.serviceIds.split(',').map((s: string) => s.trim())
        }
        if (params.groupIds) {
          attributes.group_ids = params.groupIds.split(',').map((s: string) => s.trim())
        }
        if (params.environmentIds) {
          attributes.environment_ids = params.environmentIds.split(',').map((s: string) => s.trim())
        }
        return { data: { type: 'alerts', attributes } }
      },
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: { alert: {} as RootlyCreateAlertResponse['output']['alert'] },
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
            summary: attrs.summary ?? '',
            description: attrs.description ?? null,
            source: attrs.source ?? null,
            status: attrs.status ?? null,
            externalId: attrs.external_id ?? null,
            externalUrl: attrs.external_url ?? null,
            deduplicationKey: attrs.deduplication_key ?? null,
            createdAt: attrs.created_at ?? '',
            updatedAt: attrs.updated_at ?? '',
          },
        },
      }
    },

    outputs: {
      alert: {
        type: 'object',
        description: 'The created alert',
        properties: {
          id: { type: 'string', description: 'Unique alert ID' },
          summary: { type: 'string', description: 'Alert summary' },
          description: { type: 'string', description: 'Alert description' },
          source: { type: 'string', description: 'Alert source' },
          status: { type: 'string', description: 'Alert status' },
          externalId: { type: 'string', description: 'External ID' },
          externalUrl: { type: 'string', description: 'External URL' },
          deduplicationKey: { type: 'string', description: 'Deduplication key' },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
        },
      },
    },
  }
