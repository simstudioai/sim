import {
  type DatabricksGenieAttachmentParams,
  type DatabricksGenieQueryResultResponse,
  GENIE_QUERY_RESULT_OUTPUTS,
} from '@/tools/databricks/types'
import {
  databricksErrorMessage,
  databricksUrl,
  GENIE_QUERY_ATTACHMENT_PARAMS,
  GENIE_READ_RETRY,
  genieAttachmentPath,
  mapStatementResult,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieGetQueryResultTool: ToolConfig<
  DatabricksGenieAttachmentParams,
  DatabricksGenieQueryResultResponse
> = {
  id: 'databricks_genie_get_query_result',
  name: 'Databricks Genie Get Query Result',
  description:
    'Get the rows returned by the SQL query Genie generated for a message. Available once the message is EXECUTING_QUERY or COMPLETED.',
  version: '1.0.0',

  params: GENIE_QUERY_ATTACHMENT_PARAMS,

  request: {
    url: (params) => databricksUrl(params.host, `${genieAttachmentPath(params)}/query-result`),
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
      throw new Error(databricksErrorMessage(data, 'Failed to get Genie query result'))
    }

    return {
      success: true,
      output: mapStatementResult(data.statement_response),
    }
  },

  outputs: GENIE_QUERY_RESULT_OUTPUTS,
}
