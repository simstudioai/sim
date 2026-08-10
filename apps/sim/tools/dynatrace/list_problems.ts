import {
  nextPageKeyOutput,
  pageSizeOutput,
  problemProperties,
  totalCountOutput,
  warningsOutput,
} from '@/tools/dynatrace/outputs'
import type {
  DynatraceListProblemsParams,
  DynatraceListProblemsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapProblem,
  mapWarnings,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listProblemsTool: ToolConfig<
  DynatraceListProblemsParams,
  DynatraceListProblemsResponse
> = {
  id: 'dynatrace_list_problems',
  name: 'Dynatrace List Problems',
  description:
    'List Davis-detected problems in a Dynatrace environment, filtered by timeframe, problem selector, or entity selector.',
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
      description: 'Dynatrace access token (dt0c01...) with the problems.read scope',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the timeframe as UTC milliseconds, ISO 8601, or a relative expression such as now-1d. Defaults to now-2h',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the timeframe in the same formats as From. Defaults to now',
    },
    problemSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Problem selector, e.g. status("open"),severityLevel("AVAILABILITY"),impactLevel("SERVICES")',
    },
    entitySelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Entity selector scoping the result, e.g. type("HOST"),tag("env:prod")',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order: status, startTime, or relevance, each optionally prefixed with + or - (e.g. -startTime)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated optional properties to include: evidenceDetails, impactAnalysis, recentComments',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Problems per page (max 500, default 50)',
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
        ? buildDynatraceUrl(params.environmentUrl, '/problems', {
            nextPageKey: params.nextPageKey,
          })
        : buildDynatraceUrl(params.environmentUrl, '/problems', {
            from: params.from,
            to: params.to,
            problemSelector: params.problemSelector,
            entitySelector: params.entitySelector,
            sort: params.sort,
            fields: params.fields,
            pageSize: params.pageSize,
          }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const problems = Array.isArray(data.problems)
      ? (data.problems as Array<Record<string, unknown>>)
      : []

    return {
      success: true,
      output: {
        problems: problems.map(mapProblem),
        totalCount: (data.totalCount as number) ?? null,
        pageSize: (data.pageSize as number) ?? null,
        nextPageKey: (data.nextPageKey as string) ?? null,
        warnings: mapWarnings(data.warnings),
      },
    }
  },

  outputs: {
    problems: {
      type: 'array',
      description: 'Matching problems',
      items: { type: 'object', properties: problemProperties },
    },
    totalCount: totalCountOutput,
    pageSize: pageSizeOutput,
    nextPageKey: nextPageKeyOutput,
    warnings: warningsOutput,
  },
}
