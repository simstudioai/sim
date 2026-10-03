import {
  type DatabricksGenieAttachmentParams,
  type DatabricksGenieQueryResultResponse,
  GENIE_QUERY_RESULT_OUTPUTS,
} from '@/tools/databricks/types'
import {
  databricksErrorMessage,
  databricksUrl,
  GENIE_QUERY_ATTACHMENT_PARAMS,
  genieAttachmentPath,
  mapStatementResult,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieExecuteQueryTool: ToolConfig<
  DatabricksGenieAttachmentParams,
  DatabricksGenieQueryResultResponse
> = {
  id: 'databricks_genie_execute_query',
  name: 'Databricks Genie Execute Query',
  description:
    "Re-run the SQL query Genie generated for a message. Use this when the message's query result has expired (status QUERY_RESULT_EXPIRED). If the returned status is PENDING or RUNNING, fetch the rows afterwards with Get Genie Query Result.",
  version: '1.0.0',

  params: GENIE_QUERY_ATTACHMENT_PARAMS,

  request: {
    url: (params) => databricksUrl(params.host, `${genieAttachmentPath(params)}/execute-query`),
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(databricksErrorMessage(data, 'Failed to execute Genie query'))
    }

    return {
      success: true,
      output: mapStatementResult(data.statement_response),
    }
  },

  outputs: GENIE_QUERY_RESULT_OUTPUTS,
}
