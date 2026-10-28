import type {
  DatabricksGenieMessageParams,
  DatabricksGenieSuccessResponse,
} from '@/tools/databricks/types'
import {
  databricksUrl,
  GENIE_MESSAGE_PARAMS,
  genieMessagePath,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieDeleteMessageTool: ToolConfig<
  DatabricksGenieMessageParams,
  DatabricksGenieSuccessResponse
> = {
  id: 'databricks_genie_delete_message',
  name: 'Databricks Genie Delete Message',
  description: 'Delete a message from a Genie conversation.',
  version: '1.0.0',

  params: GENIE_MESSAGE_PARAMS,

  request: {
    url: (params) => databricksUrl(params.host, genieMessagePath(params)),
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await readDatabricksError(response, 'Failed to delete Genie message'))
    }

    return {
      success: true,
      output: { success: true },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the message was deleted' },
  },
}
