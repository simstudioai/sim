import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksGenieGetSpaceResponse,
  DatabricksGenieUpdateSpaceParams,
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
import { safeUrlPathSegment } from '@/tools/url-path'

export const genieUpdateSpaceTool: ToolConfig<
  DatabricksGenieUpdateSpaceParams,
  DatabricksGenieGetSpaceResponse
> = {
  id: 'databricks_genie_update_space',
  name: 'Databricks Update Genie Space',
  description: 'Update a Genie space, optionally protecting the change with its current ETag.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    spaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Genie space identifier',
    },
    serializedSpace: {
      type: 'string',
      required: false,
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
      description: 'Description of the Genie space; an empty string clears the description',
    },
    warehouseId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SQL warehouse identifier',
    },
    etag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version from Get Genie Space; prevents overwriting concurrent changes',
    },
    parentPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent workspace folder for the Genie space',
    },
  },
  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ serializedSpace: params.serializedSpace }),
    },
    url: (params) =>
      databricksUrl(
        params.host,
        `/api/2.0/genie/spaces/${safeUrlPathSegment(params.spaceId, 'spaceId')}`
      ),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return filterUndefined({
        serialized_space: optionalDatabricksString(params.serializedSpace),
        title: optionalDatabricksString(params.title),
        description: params.description === '' ? '' : optionalDatabricksString(params.description),
        warehouse_id: optionalDatabricksString(params.warehouseId),
        etag: optionalDatabricksString(params.etag),
        parent_path: optionalDatabricksString(params.parentPath),
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to update genie space'))
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
