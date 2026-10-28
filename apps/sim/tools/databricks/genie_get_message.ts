import {
  type DatabricksGenieGetMessageResponse,
  type DatabricksGenieMessageParams,
  GENIE_MESSAGE_OUTPUT_PROPERTIES,
} from '@/tools/databricks/types'
import {
  databricksErrorMessage,
  databricksUrl,
  GENIE_MESSAGE_PARAMS,
  GENIE_READ_RETRY,
  genieMessagePath,
  mapGenieMessage,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieGetMessageTool: ToolConfig<
  DatabricksGenieMessageParams,
  DatabricksGenieGetMessageResponse
> = {
  id: 'databricks_genie_get_message',
  name: 'Databricks Genie Get Message',
  description:
    "Get a Genie message's status and answer, including the generated SQL, visualizations, and suggested follow-up questions.",
  version: '1.0.0',

  params: GENIE_MESSAGE_PARAMS,

  request: {
    url: (params) => databricksUrl(params.host, genieMessagePath(params)),
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    retry: GENIE_READ_RETRY,
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(databricksErrorMessage(data, 'Failed to get Genie message'))
    }

    return {
      success: true,
      output: mapGenieMessage(data),
    }
  },

  outputs: GENIE_MESSAGE_OUTPUT_PROPERTIES,
}
