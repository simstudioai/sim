import type {
  DatabricksGenieAgentCancelParams,
  DatabricksGenieGetMessageResponse,
} from '@/tools/databricks/types'
import { GENIE_MESSAGE_OUTPUT_PROPERTIES } from '@/tools/databricks/types'
import {
  databricksUrl,
  GENIE_SPACE_PARAMS,
  genieAgentPath,
  mapGenieMessage,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const genieAgentCancelTool: ToolConfig<
  DatabricksGenieAgentCancelParams,
  DatabricksGenieGetMessageResponse
> = {
  id: 'databricks_genie_agent_cancel',
  name: 'Databricks Genie Agent Cancel',
  description:
    'Cancel an in-flight Genie agent response using the response ID returned by the agent stream.',
  version: '1.0.0',
  params: {
    ...GENIE_SPACE_PARAMS,
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Agent conversation identifier',
    },
    responseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Response ID from the response.created stream event',
    },
  },
  request: {
    url: (params) =>
      databricksUrl(
        params.host,
        `${genieAgentPath(params.spaceId)}/conversations/${safeUrlPathSegment(params.conversationId, 'conversationId')}/responses/${safeUrlPathSegment(params.responseId, 'responseId')}/cancel`
      ),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to cancel Genie agent response'))
    return { success: true, output: mapGenieMessage(await response.json()) }
  },
  outputs: GENIE_MESSAGE_OUTPUT_PROPERTIES,
}
