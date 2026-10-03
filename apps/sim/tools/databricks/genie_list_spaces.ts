import {
  type DatabricksGenieListSpacesParams,
  type DatabricksGenieListSpacesResponse,
  GENIE_SPACE_OUTPUT_PROPERTIES,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksErrorMessage,
  databricksUrl,
  GENIE_READ_RETRY,
  mapGenieSpace,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieListSpacesTool: ToolConfig<
  DatabricksGenieListSpacesParams,
  DatabricksGenieListSpacesResponse
> = {
  id: 'databricks_genie_list_spaces',
  name: 'Databricks Genie List Spaces',
  description:
    'List the Genie spaces (Genie agents) you can access. Use this to find the space ID needed to ask Genie a question.',
  version: '1.0.0',

  params: {
    ...DATABRICKS_AUTH_PARAMS,
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of spaces to return per page (default 20, max 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(databricksUrl(params.host, '/api/2.0/genie/spaces'))
      if (params.pageSize) url.searchParams.set('page_size', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('page_token', params.pageToken)
      return url.toString()
    },
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
      throw new Error(databricksErrorMessage(data, 'Failed to list Genie spaces'))
    }

    return {
      success: true,
      output: {
        spaces: (data.spaces ?? []).map(mapGenieSpace),
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    spaces: {
      type: 'array',
      description: 'Genie spaces',
      items: {
        type: 'object',
        properties: GENIE_SPACE_OUTPUT_PROPERTIES,
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of results',
      nullable: true,
    },
  },
}
