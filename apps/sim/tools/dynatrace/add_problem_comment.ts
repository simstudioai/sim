import type {
  DynatraceAddProblemCommentParams,
  DynatraceAddProblemCommentResponse,
} from '@/tools/dynatrace/types'
import { buildDynatraceUrl, dynatraceHeaders, encodeDynatraceId } from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const addProblemCommentTool: ToolConfig<
  DynatraceAddProblemCommentParams,
  DynatraceAddProblemCommentResponse
> = {
  id: 'dynatrace_add_problem_comment',
  name: 'Dynatrace Add Problem Comment',
  description: 'Add a comment to a Dynatrace problem.',
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
      description: 'Dynatrace access token (dt0c01...) with the problems.write scope',
    },
    problemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the problem to comment on',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text of the comment',
    },
    context: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Context of the comment, shown alongside the author (e.g., the source system)',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/problems/${encodeDynatraceId(params.problemId)}/comments`
      ),
    method: 'POST',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => {
      const body: Record<string, string> = { message: params.message }
      if (params.context) body.context = params.context
      return body
    },
  },

  /** The endpoint answers 201 with no body, so the created comment is echoed back. */
  transformResponse: async (_response: Response, params?: DynatraceAddProblemCommentParams) => ({
    success: true,
    output: {
      problemId: params?.problemId ?? '',
      message: params?.message ?? '',
      context: params?.context ?? null,
    },
  }),

  outputs: {
    problemId: { type: 'string', description: 'ID of the problem the comment was added to' },
    message: { type: 'string', description: 'Text of the comment that was added' },
    context: { type: 'string', description: 'Context of the comment', nullable: true },
  },
}
