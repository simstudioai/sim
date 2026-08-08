import { syntheticMonitorProperties } from '@/tools/dynatrace/outputs'
import type {
  DynatraceListSyntheticMonitorsParams,
  DynatraceListSyntheticMonitorsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceV1Url,
  dynatraceHeaders,
  mapSyntheticMonitor,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listSyntheticMonitorsTool: ToolConfig<
  DynatraceListSyntheticMonitorsParams,
  DynatraceListSyntheticMonitorsResponse
> = {
  id: 'dynatrace_list_synthetic_monitors',
  name: 'Dynatrace List Synthetic Monitors',
  description:
    'List synthetic monitors and their IDs. Use it to find the monitor IDs to feed into an on-demand execution.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.DYNATRACE_ERRORS,

  params: {
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dynatrace environment URL (e.g., https://abc12345.live.dynatrace.com, or https://your-activegate:9999/e/abc12345 for Managed)',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dynatrace access token (dt0c01...) with one of ReadSyntheticData, DataExport, or ExternalSyntheticIntegration',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by monitor type: BROWSER or HTTP',
    },
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to enabled (true) or disabled (false) monitors',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to monitors assigned to a synthetic location',
    },
    tag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by tag. Comma-separate to require several tags',
    },
    managementZone: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to monitors in a management zone, by numeric zone ID',
    },
  },

  /** Synthetic monitors are the one part of this integration still on Environment API v1. */
  request: {
    url: (params) =>
      buildDynatraceV1Url(params.environmentUrl, '/synthetic/monitors', {
        type: params.type,
        enabled: params.enabled,
        location: params.location,
        // `tag` is repeatable; the URL builder appends one entry per value.
        tag: params.tag
          ? params.tag
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean)
          : undefined,
        managementZone: params.managementZone,
      }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const monitors = Array.isArray(data.monitors)
      ? (data.monitors as Array<Record<string, unknown>>)
      : []

    return {
      success: true,
      output: {
        monitors: monitors.map(mapSyntheticMonitor),
      },
    }
  },

  outputs: {
    monitors: {
      type: 'array',
      description: 'Matching synthetic monitors',
      items: { type: 'object', properties: syntheticMonitorProperties },
    },
  },
}
