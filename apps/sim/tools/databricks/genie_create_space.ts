import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksGenieCreateSpaceParams,
  DatabricksGenieGetSpaceResponse,
} from '@/tools/databricks/types'
import { GENIE_SPACE_OUTPUT_PROPERTIES } from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  mapGenieSpace,
  optionalDatabricksString,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieCreateSpaceTool: ToolConfig<
  DatabricksGenieCreateSpaceParams,
  DatabricksGenieGetSpaceResponse
> = {
  id: 'databricks_genie_create_space',
  name: 'Databricks Create Genie Space',
  description: 'Create a Genie space from its serialized configuration and a SQL warehouse.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    warehouseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SQL warehouse identifier',
    },
    parentPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent workspace folder for the Genie space',
    },
    serializedSpace: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Serialized Genie configuration JSON, including data_sources, instructions, config, and benchmarks; get an example with Get Genie Space',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Genie space title',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the Genie space',
    },
  },
  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ serializedSpace: params.serializedSpace }),
    },
    url: (params) => databricksUrl(params.host, `/api/2.0/genie/spaces`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return filterUndefined({
        warehouse_id: params.warehouseId,
        parent_path: optionalDatabricksString(params.parentPath),
        serialized_space: params.serializedSpace,
        title: optionalDatabricksString(params.title),
        description: optionalDatabricksString(params.description),
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to create genie space'))
    const data = await response.json()
    return {
      success: true,
      output: { ...mapGenieSpace(data), serializedSpace: data.serialized_space ?? null },
    }
  },
  outputs: {
    ...GENIE_SPACE_OUTPUT_PROPERTIES,
    serializedSpace: {
      type: 'string',
      nullable: true,
      description:
        'Serialized Genie configuration (data_sources, instructions, config, benchmarks)',
    },
  },
}
