import {
  type DatabricksGenieGetSpaceParams,
  type DatabricksGenieGetSpaceResponse,
  GENIE_SPACE_OUTPUT_PROPERTIES,
} from '@/tools/databricks/types'
import {
  databricksErrorMessage,
  databricksUrl,
  GENIE_READ_RETRY,
  GENIE_SPACE_PARAMS,
  genieSpacePath,
  mapGenieSpace,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieGetSpaceTool: ToolConfig<
  DatabricksGenieGetSpaceParams,
  DatabricksGenieGetSpaceResponse
> = {
  id: 'databricks_genie_get_space',
  name: 'Databricks Genie Get Space',
  description:
    "Get a Genie space's title, description, and SQL warehouse, optionally with its full configuration export (tables, instructions, sample questions).",
  version: '1.0.0',

  params: {
    ...GENIE_SPACE_PARAMS,
    includeSerializedSpace: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Include the space's serialized configuration export (requires CAN EDIT on the space)",
    },
  },

  request: {
    url: (params) => {
      const url = new URL(databricksUrl(params.host, genieSpacePath(params.spaceId)))
      if (params.includeSerializedSpace) url.searchParams.set('include_serialized_space', 'true')
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
      throw new Error(databricksErrorMessage(data, 'Failed to get Genie space'))
    }

    return {
      success: true,
      output: {
        ...mapGenieSpace(data),
        serializedSpace: data.serialized_space ?? null,
      },
    }
  },

  outputs: {
    ...GENIE_SPACE_OUTPUT_PROPERTIES,
    serializedSpace: {
      type: 'string',
      description:
        'Serialized space configuration as a JSON string (data sources, instructions, sample questions)',
      nullable: true,
    },
  },
}
