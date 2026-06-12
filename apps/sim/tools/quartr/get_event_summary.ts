import {
  QUARTR_SUMMARY_SOURCE_OUTPUT_PROPERTIES,
  type QuartrGetEventSummaryParams,
  type QuartrGetEventSummaryResponse,
  type QuartrSingleDto,
  type QuartrSummaryDto,
} from '@/tools/quartr/types'
import {
  buildQuartrUrl,
  isQuartrToggleEnabled,
  mapQuartrSummarySource,
  parseQuartrResponse,
} from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrGetEventSummaryTool: ToolConfig<
  QuartrGetEventSummaryParams,
  QuartrGetEventSummaryResponse
> = {
  id: 'quartr_get_event_summary',
  name: 'Quartr Get Event Summary',
  description:
    'Retrieve the AI-generated summary of a corporate event from Quartr, with selectable length and optional plain-text formatting.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Quartr API key',
    },
    eventId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Quartr event ID (e.g., 128301)',
    },
    summaryLength: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Length preset for the summary: "line", "short", or "long" (default: short)',
    },
    plainSummary: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return a plain-text summary without embedded document source tags',
    },
  },

  request: {
    url: (params) =>
      buildQuartrUrl(`/events/${encodeURIComponent(String(params.eventId).trim())}/summary`, {
        length: params.summaryLength,
        plain: isQuartrToggleEnabled(params.plainSummary) ? true : undefined,
      }),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrSingleDto<QuartrSummaryDto>>(
      response,
      'get event summary'
    )
    const summary = data.data

    return {
      success: true,
      output: {
        summary: summary.summary,
        sources: (summary.sources ?? []).map(mapQuartrSummarySource),
        summaryId: summary.id,
        summaryCreatedAt: summary.createdAt,
        summaryUpdatedAt: summary.updatedAt,
      },
    }
  },

  outputs: {
    summary: {
      type: 'string',
      description:
        'AI-generated event summary in Markdown (includes embedded document source tags unless a plain-text summary is requested)',
    },
    sources: {
      type: 'array',
      description: 'Source documents referenced by the summary',
      items: { type: 'object', properties: QUARTR_SUMMARY_SOURCE_OUTPUT_PROPERTIES },
    },
    summaryId: { type: 'number', description: 'Quartr summary ID' },
    summaryCreatedAt: {
      type: 'string',
      description: 'Summary creation timestamp (ISO 8601)',
    },
    summaryUpdatedAt: {
      type: 'string',
      description: 'Summary last update timestamp (ISO 8601)',
    },
  },
}
