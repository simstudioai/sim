import type { RootlyUpdateAlertParams, RootlyUpdateAlertResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyUpdateAlertTool: ToolConfig<RootlyUpdateAlertParams, RootlyUpdateAlertResponse> =
  {
    id: 'rootly_update_alert',
    name: 'Rootly Update Alert',
    description: 'Update an existing alert in Rootly.',
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
        description: 'The ID of the alert to update',
      },
      summary: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Updated alert summary',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Updated alert description',
      },
      source: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Updated alert source',
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
        description: 'Updated external ID',
      },
      externalUrl: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Updated external URL',
      },
      deduplicationKey: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Updated deduplication key',
      },
    },

    request: {
      url: (params) => `https://api.rootly.com/v1/alerts/${params.alertId.trim()}`,
      method: 'PATCH',
      headers: (params) => ({
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const attributes: Record<string, unknown> = {}
        if (params.summary) attributes.summary = params.summary
        if (params.description) attributes.description = params.description
        if (params.source) attributes.source = params.source
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
        return { data: { type: 'alerts', id: params.alertId.trim(), attributes } }
      },
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: { alert: {} as RootlyUpdateAlertResponse['output']['alert'] },
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
        description: 'The updated alert',
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
