import { commentProperties } from '@/tools/dynatrace/outputs'
import type {
  DynatraceGetProblemCommentParams,
  DynatraceGetProblemCommentResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  mapComment,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const getProblemCommentTool: ToolConfig<
  DynatraceGetProblemCommentParams,
  DynatraceGetProblemCommentResponse
> = {
  id: 'dynatrace_get_problem_comment',
  name: 'Dynatrace Get Problem Comment',
  description: 'Get a single comment on a Dynatrace problem.',
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
      description: 'ID of the problem the comment belongs to',
    },
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the comment',
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
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        comment: mapComment(data) ?? {
          id: null,
          authorName: null,
          content: null,
          context: null,
          createdAtTimestamp: null,
        },
      },
    }
  },

  outputs: {
    comment: {
      type: 'object',
      description: 'The requested comment',
      properties: commentProperties,
    },
  },
}
