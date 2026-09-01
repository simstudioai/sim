import {
  nextPageKeyOutput,
  pageSizeOutput,
  sloProperties,
  totalCountOutput,
} from '@/tools/dynatrace/outputs'
import type { DynatraceListSlosParams, DynatraceListSlosResponse } from '@/tools/dynatrace/types'
import { buildDynatraceUrl, dynatraceHeaders, mapSlo, readJsonBody } from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listSlosTool: ToolConfig<DynatraceListSlosParams, DynatraceListSlosResponse> = {
  id: 'dynatrace_list_slos',
  name: 'Dynatrace List SLOs',
  description:
    'List service-level objectives with their current attainment, error budget, and burn rate.',
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
      description: 'Dynatrace access token (dt0c01...) with the slo.read scope',
    },
    sloSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'SLO selector, e.g. healthState("WARNING"),text("checkout"),problems("true"). Combine criteria with commas',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the evaluation timeframe as UTC milliseconds, ISO 8601, or a relative expression such as now-7d',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the evaluation timeframe in the same formats as From. Defaults to now',
    },
    timeFrame: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CURRENT evaluates each SLO over its own timeframe; GTF evaluates over the From/To range',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by name: name ascending or -name descending',
    },
    enabledSlos: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by enabled state: true, false, or all',
    },
    evaluate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Evaluate each SLO and include its calculated values',
    },
    showGlobalSlos: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include SLOs that are not scoped to a management zone',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'SLOs per page (max 10000, default 10)',
    },
    nextPageKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for the next page. All other filters are ignored when it is set',
    },
  },

  request: {
    url: (params) =>
      params.nextPageKey
        ? buildDynatraceUrl(params.environmentUrl, '/slo', { nextPageKey: params.nextPageKey })
        : buildDynatraceUrl(params.environmentUrl, '/slo', {
            sloSelector: params.sloSelector,
            from: params.from,
            to: params.to,
            timeFrame: params.timeFrame,
            sort: params.sort,
            enabledSlos: params.enabledSlos,
            evaluate: params.evaluate,
            showGlobalSlos: params.showGlobalSlos,
            pageSize: params.pageSize,
          }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const slos = Array.isArray(data.slo) ? (data.slo as Array<Record<string, unknown>>) : []

    return {
      success: true,
      output: {
        slos: slos.map(mapSlo),
        totalCount: (data.totalCount as number) ?? null,
        pageSize: (data.pageSize as number) ?? null,
        nextPageKey: (data.nextPageKey as string) ?? null,
      },
    }
  },

  outputs: {
    slos: {
      type: 'array',
      description: 'Matching service-level objectives',
      items: { type: 'object', properties: sloProperties },
    },
    totalCount: totalCountOutput,
    pageSize: pageSizeOutput,
    nextPageKey: nextPageKeyOutput,
  },
}
