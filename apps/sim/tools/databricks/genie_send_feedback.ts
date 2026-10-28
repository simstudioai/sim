import type {
  DatabricksGenieSendFeedbackParams,
  DatabricksGenieSuccessResponse,
} from '@/tools/databricks/types'
import {
  databricksUrl,
  GENIE_MESSAGE_PARAMS,
  genieMessagePath,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieSendFeedbackTool: ToolConfig<
  DatabricksGenieSendFeedbackParams,
  DatabricksGenieSuccessResponse
> = {
  id: 'databricks_genie_send_feedback',
  name: 'Databricks Genie Send Feedback',
  description:
    "Rate a Genie answer as positive or negative, with an optional comment. Space authors use this feedback to improve the space's instructions.",
  version: '1.0.0',

  params: {
    ...GENIE_MESSAGE_PARAMS,
    rating: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Feedback rating: POSITIVE, NEGATIVE, or NONE (clears a previous rating)',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional feedback comment (max 5000 characters)',
    },
  },

  request: {
    url: (params) => databricksUrl(params.host, `${genieMessagePath(params)}/feedback`),
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      rating: params.rating,
      ...(params.comment ? { comment: params.comment } : {}),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await readDatabricksError(response, 'Failed to send Genie feedback'))
    }

    return {
      success: true,
      output: { success: true },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the feedback was recorded' },
  },
}
