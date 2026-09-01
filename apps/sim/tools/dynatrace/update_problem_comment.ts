import type {
  DynatraceUpdateProblemCommentParams,
  DynatraceUpdateProblemCommentResponse,
} from '@/tools/dynatrace/types'
import { buildDynatraceUrl, dynatraceHeaders, encodeDynatraceId } from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const updateProblemCommentTool: ToolConfig<
  DynatraceUpdateProblemCommentParams,
  DynatraceUpdateProblemCommentResponse
> = {
  id: 'dynatrace_update_problem_comment',
  name: 'Dynatrace Update Problem Comment',
  description: 'Replace the text of an existing comment on a Dynatrace problem.',
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
      description: 'ID of the problem the comment belongs to',
    },
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the comment to update',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Replacement text of the comment',
    },
    context: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Context of the comment, shown alongside the author',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/problems/${encodeDynatraceId(params.problemId)}/comments/${encodeDynatraceId(
          params.commentId
        )}`
      ),
    method: 'PUT',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => {
      const body: Record<string, string> = { message: params.message }
      if (params.context) body.context = params.context
      return body
    },
  },

  /** The endpoint answers 204 with no body, so the update is echoed back. */
  transformResponse: async (_response: Response, params?: DynatraceUpdateProblemCommentParams) => ({
    success: true,
    output: {
      problemId: params?.problemId ?? '',
      commentId: params?.commentId ?? '',
      message: params?.message ?? '',
      context: params?.context ?? null,
    },
  }),

  outputs: {
    problemId: { type: 'string', description: 'ID of the problem' },
    commentId: { type: 'string', description: 'ID of the updated comment' },
    message: { type: 'string', description: 'Text the comment now carries' },
    context: { type: 'string', description: 'Context of the comment', nullable: true },
  },
}
