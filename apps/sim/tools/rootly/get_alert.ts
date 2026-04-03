import type { RootlyGetAlertParams, RootlyGetAlertResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyGetAlertTool: ToolConfig<RootlyGetAlertParams, RootlyGetAlertResponse> = {
  id: 'rootly_get_alert',
  name: 'Rootly Get Alert',
  description: 'Retrieve a single alert by ID from Rootly.',
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
      description: 'The ID of the alert to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.rootly.com/v1/alerts/${params.alertId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { alert: {} as RootlyGetAlertResponse['output']['alert'] },
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
      description: 'The alert details',
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
