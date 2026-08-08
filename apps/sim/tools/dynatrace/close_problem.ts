import { commentProperties } from '@/tools/dynatrace/outputs'
import type {
  DynatraceCloseProblemParams,
  DynatraceCloseProblemResponse,
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

export const closeProblemTool: ToolConfig<
  DynatraceCloseProblemParams,
  DynatraceCloseProblemResponse
> = {
  id: 'dynatrace_close_problem',
  name: 'Dynatrace Close Problem',
  description: 'Close a Dynatrace problem and record the closing comment.',
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
      description: 'ID of the problem to close',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text of the closing comment',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/problems/${encodeDynatraceId(params.problemId)}/close`
      ),
    method: 'POST',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => ({ message: params.message }),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        problemId: (data.problemId as string) ?? null,
        closeTimestamp: (data.closeTimestamp as number) ?? null,
        closing: (data.closing as boolean) ?? null,
        comment: mapComment(data.comment),
      },
    }
  },

  outputs: {
    problemId: { type: 'string', description: 'ID of the closed problem', nullable: true },
    closeTimestamp: {
      type: 'number',
      description: 'Timestamp when closing was triggered, in UTC milliseconds',
      nullable: true,
    },
    closing: {
      type: 'boolean',
      description: 'Whether the problem is in the process of being closed',
      nullable: true,
    },
    comment: {
      type: 'object',
      description: 'The closing comment that was recorded',
      nullable: true,
      properties: commentProperties,
    },
  },
}
