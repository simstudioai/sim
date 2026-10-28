import type {
  DatabricksGenieDeleteConversationParams,
  DatabricksGenieSuccessResponse,
} from '@/tools/databricks/types'
import {
  databricksUrl,
  GENIE_SPACE_PARAMS,
  genieConversationPath,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieDeleteConversationTool: ToolConfig<
  DatabricksGenieDeleteConversationParams,
  DatabricksGenieSuccessResponse
> = {
  id: 'databricks_genie_delete_conversation',
  name: 'Databricks Genie Delete Conversation',
  description: 'Delete a Genie conversation you no longer need.',
  version: '1.0.0',

  params: {
    ...GENIE_SPACE_PARAMS,
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the Genie conversation to delete',
    },
  },

  request: {
    url: (params) =>
      databricksUrl(params.host, genieConversationPath(params.spaceId, params.conversationId)),
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await readDatabricksError(response, 'Failed to delete Genie conversation'))
    }

    return {
      success: true,
      output: { success: true },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the conversation was deleted' },
  },
}
