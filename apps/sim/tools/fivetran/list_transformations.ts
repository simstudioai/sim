import {
  type FivetranListTransformationsParams,
  type FivetranListTransformationsResponse,
  NEXT_CURSOR_OUTPUT,
  TRANSFORMATION_PROPERTIES,
} from '@/tools/fivetran/types'
import {
  envelopePage,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  FIVETRAN_PAGINATION_PARAMS,
  fivetranHeaders,
  fivetranPaginationQuery,
  fivetranUrl,
  mapTransformation,
  trimmed,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranListTransformationsTool: ToolConfig<
  FivetranListTransformationsParams,
  FivetranListTransformationsResponse
> = {
  id: 'fivetran_list_transformations',
  name: 'Fivetran List Transformations',
  description:
    'List Fivetran transformations (dbt Core and Quickstart) with their status, schedule, and last run times.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return transformations in this group',
    },
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return transformations in this dbt project',
    },
    transformationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return this type: DBT_CORE or QUICKSTART',
    },
    ...FIVETRAN_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      fivetranUrl('/transformations', {
        group_id: trimmed(params.groupId),
        project_id: trimmed(params.projectId),
        type: trimmed(params.transformationType),
        ...fivetranPaginationQuery(params),
      }),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const { items, nextCursor } = envelopePage(await response.json())
    return {
      success: true,
      output: { transformations: items.map(mapTransformation), nextCursor },
    }
  },

  outputs: {
    transformations: {
      type: 'array',
      description: 'Transformations',
      items: { type: 'object', properties: TRANSFORMATION_PROPERTIES },
    },
    ...NEXT_CURSOR_OUTPUT,
  },
}
