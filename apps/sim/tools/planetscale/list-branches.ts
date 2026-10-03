import { z } from 'zod'
import {
  PLANETSCALE_BRANCH_OUTPUT_PROPERTIES,
  PLANETSCALE_PAGINATION_OUTPUT,
  type PlanetScaleBranch,
  type PlanetScaleListBranchesParams,
  type PlanetScalePagination,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  optionalPlanetScaleBoolean,
  optionalPlanetScaleEnum,
  optionalPlanetScaleInteger,
  optionalPlanetScaleString,
  PLANETSCALE_READ_RETRY,
  planetScaleApiUrl,
  planetScaleBranchSchema,
  planetScaleHeaders,
  planetScaleJson,
  planetScalePaginationSchema,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleListBranchesTool: ToolConfig<
  PlanetScaleListBranchesParams,
  PlanetScaleToolResponse<{ branches: PlanetScaleBranch[]; pagination: PlanetScalePagination }>
> = {
  id: 'planetscale_list_branches',
  name: 'PlanetScale List Branches',
  description: 'List branches',
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
    database: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Database name slug from `list_databases`. Example: `app-db`.',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search branches by name',
    },
    production: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter branches by production status',
    },
    safeMigrations: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter branches by safe migrations (DDL protection)',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order branches by created_at time',
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
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/branches`,
        {
          q: optionalPlanetScaleString(params.q, 'q'),
          production: optionalPlanetScaleBoolean(params.production, 'production'),
          safe_migrations: optionalPlanetScaleBoolean(params.safeMigrations, 'safeMigrations'),
          order: optionalPlanetScaleEnum(params.order, 'order', ['asc', 'desc']),
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
    const resources = z.object({ data: z.array(planetScaleBranchSchema) }).parse(data)
    return {
      success: true,
      output: { branches: resources.data, pagination: planetScalePaginationSchema.parse(data) },
    }
  },
  outputs: {
    branches: {
      type: 'array',
      description: 'branches',
      items: { type: 'object', properties: PLANETSCALE_BRANCH_OUTPUT_PROPERTIES },
    },
    pagination: PLANETSCALE_PAGINATION_OUTPUT,
  },
}
