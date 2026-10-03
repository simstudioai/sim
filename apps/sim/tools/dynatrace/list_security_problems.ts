import {
  nextPageKeyOutput,
  pageSizeOutput,
  securityProblemProperties,
  totalCountOutput,
} from '@/tools/dynatrace/outputs'
import type {
  DynatraceListSecurityProblemsParams,
  DynatraceListSecurityProblemsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapSecurityProblem,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listSecurityProblemsTool: ToolConfig<
  DynatraceListSecurityProblemsParams,
  DynatraceListSecurityProblemsResponse
> = {
  id: 'dynatrace_list_security_problems',
  name: 'Dynatrace List Security Problems',
  description:
    'List vulnerabilities detected by Dynatrace Application Security, filtered by risk level, status, CVE, or technology.',
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
      description: 'Dynatrace access token (dt0c01...) with the securityProblems.read scope',
    },
    securityProblemSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Security problem selector, e.g. status("OPEN"),riskLevel("CRITICAL"),technology("JAVA")',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the timeframe as UTC milliseconds, ISO 8601, or a relative expression such as now-7d. Defaults to now-30d',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the timeframe in the same formats as From. Defaults to now',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated optional properties to include: +riskAssessment, +managementZones, +codeLevelVulnerabilityDetails, +globalCounts',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by a field with a + or - prefix, e.g. -riskAssessment.riskScore',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Security problems per page (max 500, default 100)',
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
        ? buildDynatraceUrl(params.environmentUrl, '/securityProblems', {
            nextPageKey: params.nextPageKey,
          })
        : buildDynatraceUrl(params.environmentUrl, '/securityProblems', {
            securityProblemSelector: params.securityProblemSelector,
            from: params.from,
            to: params.to,
            fields: params.fields,
            sort: params.sort,
            pageSize: params.pageSize,
          }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const securityProblems = Array.isArray(data.securityProblems)
      ? (data.securityProblems as Array<Record<string, unknown>>)
      : []

    return {
      success: true,
      output: {
        securityProblems: securityProblems.map(mapSecurityProblem),
        totalCount: (data.totalCount as number) ?? null,
        pageSize: (data.pageSize as number) ?? null,
        nextPageKey: (data.nextPageKey as string) ?? null,
      },
    }
  },

  outputs: {
    securityProblems: {
      type: 'array',
      description: 'Matching security problems',
      items: { type: 'object', properties: securityProblemProperties },
    },
    totalCount: totalCountOutput,
    pageSize: pageSizeOutput,
    nextPageKey: nextPageKeyOutput,
  },
}
