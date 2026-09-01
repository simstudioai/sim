import type {
  DynatraceDeleteProblemCommentParams,
  DynatraceDeleteProblemCommentResponse,
} from '@/tools/dynatrace/types'
import { buildDynatraceUrl, dynatraceHeaders, encodeDynatraceId } from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const deleteProblemCommentTool: ToolConfig<
  DynatraceDeleteProblemCommentParams,
  DynatraceDeleteProblemCommentResponse
> = {
  id: 'dynatrace_delete_problem_comment',
  name: 'Dynatrace Delete Problem Comment',
  description: 'Delete a comment from a Dynatrace problem.',
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
      description: 'ID of the comment to delete',
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
    method: 'DELETE',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  /** The endpoint answers 204 with no body, so the deleted IDs are echoed back. */
  transformResponse: async (_response: Response, params?: DynatraceDeleteProblemCommentParams) => ({
    success: true,
    output: {
      problemId: params?.problemId ?? '',
      commentId: params?.commentId ?? '',
      deleted: true,
    },
  }),

  outputs: {
    problemId: { type: 'string', description: 'ID of the problem' },
    commentId: { type: 'string', description: 'ID of the deleted comment' },
    deleted: { type: 'boolean', description: 'Always true — a failed delete raises instead' },
  },
}
