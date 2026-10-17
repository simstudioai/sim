import type {
  DatabricksGenieDeleteSpaceParams,
  DatabricksSuccessResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const genieDeleteSpaceTool: ToolConfig<
  DatabricksGenieDeleteSpaceParams,
  DatabricksSuccessResponse
> = {
  id: 'databricks_genie_delete_space',
  name: 'Databricks Trash Genie Space',
  description: 'Move a Genie space to the trash.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    spaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Genie space identifier',
    },
  },
  request: {
    url: (params) =>
      databricksUrl(
        params.host,
        `/api/2.0/genie/spaces/${safeUrlPathSegment(params.spaceId, 'spaceId')}`
      ),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to trash genie space'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
  },
}
