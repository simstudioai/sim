import { z } from 'zod'
import {
  PLANETSCALE_DEPLOYREQUEST_OUTPUT_PROPERTIES,
  PLANETSCALE_PAGINATION_OUTPUT,
  type PlanetScaleDeployRequest,
  type PlanetScaleListDeployRequestsParams,
  type PlanetScalePagination,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  optionalPlanetScaleInteger,
  optionalPlanetScaleString,
  PLANETSCALE_READ_RETRY,
  planetScaleApiUrl,
  planetScaleDeployRequestSchema,
  planetScaleHeaders,
  planetScaleJson,
  planetScalePaginationSchema,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleListDeployRequestsTool: ToolConfig<
  PlanetScaleListDeployRequestsParams,
  PlanetScaleToolResponse<{
    deployRequests: PlanetScaleDeployRequest[]
    pagination: PlanetScalePagination
  }>
> = {
  id: 'planetscale_list_deploy_requests',
  name: 'PlanetScale List Deploy Requests',
  description: 'List deploy requests (Vitess only)',
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
      description: "The name of the deploy request's database",
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by state of the deploy request (open, closed, deployed)',
    },
    branch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by the name of the branch the deploy request is created from',
    },
    intoBranch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by the name of the branch the deploy request will be merged into',
    },
    deployedAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter deploy requests by the date they were deployed. (e.g. 2023-01-01T00:00:00Z..2023-01-31T23:59:59Z)',
    },
    runningAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter deploy requests by the date they were running. (e.g. 2023-01-01T00:00:00Z..2023-01-31T23:59:59Z)',
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
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/deploy-requests`,
        {
          state: optionalPlanetScaleString(params.state, 'state'),
          branch: optionalPlanetScaleString(params.branch, 'branch'),
          into_branch: optionalPlanetScaleString(params.intoBranch, 'intoBranch'),
          deployed_at: optionalPlanetScaleString(params.deployedAt, 'deployedAt'),
          running_at: optionalPlanetScaleString(params.runningAt, 'runningAt'),
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
    const resources = z.object({ data: z.array(planetScaleDeployRequestSchema) }).parse(data)
    return {
      success: true,
      output: {
        deployRequests: resources.data,
        pagination: planetScalePaginationSchema.parse(data),
      },
    }
  },
  outputs: {
    deployRequests: {
      type: 'array',
      description: 'deploy requests',
      items: { type: 'object', properties: PLANETSCALE_DEPLOYREQUEST_OUTPUT_PROPERTIES },
    },
    pagination: PLANETSCALE_PAGINATION_OUTPUT,
  },
}
