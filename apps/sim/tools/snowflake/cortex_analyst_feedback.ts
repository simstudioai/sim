import type {
  SnowflakeCortexAnalystFeedbackParams,
  SnowflakeCortexAnalystFeedbackResponse,
} from '@/tools/snowflake/types'
import {
  getSnowflakeBaseUrl,
  getSnowflakeHeaders,
  snowflakeAuthParamFields,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

/** The rating is required, so anything other than a boolean or its string form is rejected. */
function readRating(value: unknown): boolean {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Rating must be true (positive) or false (negative)')
}

export const cortexAnalystFeedbackTool: ToolConfig<
  SnowflakeCortexAnalystFeedbackParams,
  SnowflakeCortexAnalystFeedbackResponse
> = {
  id: 'snowflake_cortex_analyst_feedback',
  version: '1.0.0',
  name: 'Snowflake Cortex Analyst Feedback',
  description:
    'Rate a Cortex Analyst answer thumbs up or down, with an optional comment. Feedback appears in the Snowsight Cortex Analyst monitoring tab.',
  params: {
    ...snowflakeAuthParamFields,
    requestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Request ID returned by Cortex Analyst Ask',
    },
    positive: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'true for positive (thumbs up) feedback, false for negative (thumbs down)',
    },
    feedbackMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional feedback comment',
    },
  },
  request: {
    url: (params) => `${getSnowflakeBaseUrl(params)}/api/v2/cortex/analyst/feedback`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: (params) => {
      const requestId = params.requestId?.trim()
      if (!requestId) throw new Error('Request ID is required')
      const feedbackMessage = params.feedbackMessage?.trim()
      return {
        request_id: requestId,
        positive: readRating(params.positive),
        ...(feedbackMessage ? { feedback_message: feedbackMessage } : {}),
      }
    },
  },
  transformResponse: async () => ({
    success: true,
    output: { success: true },
  }),
  outputs: {
    success: { type: 'boolean', description: 'Whether the feedback was recorded' },
  },
}
