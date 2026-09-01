import {
  commentProperties,
  nextPageKeyOutput,
  pageSizeOutput,
  totalCountOutput,
} from '@/tools/dynatrace/outputs'
import type {
  DynatraceComment,
  DynatraceListProblemCommentsParams,
  DynatraceListProblemCommentsResponse,
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

export const listProblemCommentsTool: ToolConfig<
  DynatraceListProblemCommentsParams,
  DynatraceListProblemCommentsResponse
> = {
  id: 'dynatrace_list_problem_comments',
  name: 'Dynatrace List Problem Comments',
  description: 'List the comments recorded on a Dynatrace problem.',
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
      description: 'ID of the problem whose comments should be listed',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comments per page (max 500, default 10)',
    },
    nextPageKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for the next page. Page size is ignored when it is set',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/problems/${encodeDynatraceId(params.problemId)}/comments`,
        params.nextPageKey ? { nextPageKey: params.nextPageKey } : { pageSize: params.pageSize }
      ),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const comments = Array.isArray(data.comments)
      ? (data.comments as Array<Record<string, unknown>>)
      : []

    return {
      success: true,
      output: {
        comments: comments
          .map(mapComment)
          .filter((comment): comment is DynatraceComment => comment !== null),
        totalCount: (data.totalCount as number) ?? null,
        pageSize: (data.pageSize as number) ?? null,
        nextPageKey: (data.nextPageKey as string) ?? null,
      },
    }
  },

  outputs: {
    comments: {
      type: 'array',
      description: 'Comments on the problem',
      items: { type: 'object', properties: commentProperties },
    },
    totalCount: totalCountOutput,
    pageSize: pageSizeOutput,
    nextPageKey: nextPageKeyOutput,
  },
}
