import { z } from 'zod'
import {
  PLANETSCALE_DATABASE_OUTPUT_PROPERTIES,
  PLANETSCALE_PAGINATION_OUTPUT,
  type PlanetScaleDatabase,
  type PlanetScaleListDatabasesParams,
  type PlanetScalePagination,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  optionalPlanetScaleInteger,
  optionalPlanetScaleString,
  PLANETSCALE_READ_RETRY,
  planetScaleApiUrl,
  planetScaleDatabaseSchema,
  planetScaleHeaders,
  planetScaleJson,
  planetScalePaginationSchema,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleListDatabasesTool: ToolConfig<
  PlanetScaleListDatabasesParams,
  PlanetScaleToolResponse<{ databases: PlanetScaleDatabase[]; pagination: PlanetScalePagination }>
> = {
  id: 'planetscale_list_databases',
  name: 'PlanetScale List Databases',
  description: 'List databases',
  version: '1.0.0',
  params: {
    serviceTokenId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PlanetScale service token ID',
    },
    serviceToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PlanetScale service token secret',
    },
    organization: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PlanetScale organization slug',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter databases by name',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'If provided, specifies the page offset of returned results',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'If provided, specifies the number of returned results',
    },
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases`,
        {
          q: optionalPlanetScaleString(params.q, 'q'),
          page: optionalPlanetScaleInteger(params.page, 'page'),
          per_page: optionalPlanetScaleInteger(params.perPage, 'perPage'),
        }
      ),
    method: 'GET',
    headers: planetScaleHeaders,
    retry: PLANETSCALE_READ_RETRY,
  },
  transformResponse: async (response) => {
    const data = await planetScaleJson(response)
    const resources = z.object({ data: z.array(planetScaleDatabaseSchema) }).parse(data)
    return {
      success: true,
      output: { databases: resources.data, pagination: planetScalePaginationSchema.parse(data) },
    }
  },
  outputs: {
    databases: {
      type: 'array',
      description: 'databases',
      items: { type: 'object', properties: PLANETSCALE_DATABASE_OUTPUT_PROPERTIES },
    },
    pagination: PLANETSCALE_PAGINATION_OUTPUT,
  },
}
