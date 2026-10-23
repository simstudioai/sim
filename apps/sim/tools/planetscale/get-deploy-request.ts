import {
  PLANETSCALE_DEPLOYREQUEST_OUTPUT_PROPERTIES,
  type PlanetScaleDeployRequest,
  type PlanetScaleGetDeployRequestParams,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  PLANETSCALE_READ_RETRY,
  planetScaleApiUrl,
  planetScaleDeployRequestSchema,
  planetScaleHeaders,
  planetScaleJson,
  planetScaleNumber,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleGetDeployRequestTool: ToolConfig<
  PlanetScaleGetDeployRequestParams,
  PlanetScaleToolResponse<{ deployRequest: PlanetScaleDeployRequest }>
> = {
  id: 'planetscale_get_deploy_request',
  name: 'PlanetScale Get Deploy Request',
  description: 'Get a deploy request (Vitess only)',
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
    deployRequestNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The number of the deploy request',
    },
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/deploy-requests/${planetScaleNumber(params.deployRequestNumber, 'deployRequestNumber')}`,
        {}
      ),
    method: 'GET',
    headers: planetScaleHeaders,
    retry: PLANETSCALE_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: {
      deployRequest: planetScaleDeployRequestSchema.parse(await planetScaleJson(response)),
    },
  }),
  outputs: {
    deployRequest: {
      type: 'json',
      description: 'DeployRequest details',
      properties: PLANETSCALE_DEPLOYREQUEST_OUTPUT_PROPERTIES,
    },
  },
}
