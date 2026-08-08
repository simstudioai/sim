import { problemProperties } from '@/tools/dynatrace/outputs'
import type {
  DynatraceGetProblemParams,
  DynatraceGetProblemResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  mapProblem,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const getProblemTool: ToolConfig<DynatraceGetProblemParams, DynatraceGetProblemResponse> = {
  id: 'dynatrace_get_problem',
  name: 'Dynatrace Get Problem',
  description:
    'Get the full details of a single Dynatrace problem, including root cause, affected entities, and optionally its evidence and impact analysis.',
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
    problemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the problem (e.g., -1234567890123456789_1700000000000V2)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated optional properties to include: evidenceDetails, impactAnalysis, recentComments',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(params.environmentUrl, `/problems/${encodeDynatraceId(params.problemId)}`, {
        fields: params.fields,
      }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        problem: mapProblem(data),
      },
    }
  },

  outputs: {
    problem: {
      type: 'object',
      description: 'The requested problem',
      properties: problemProperties,
    },
  },
}
