import {
  PLANETSCALE_DEPLOYREQUEST_OUTPUT_PROPERTIES,
  type PlanetScaleCloseDeployRequestParams,
  type PlanetScaleDeployRequest,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  planetScaleApiUrl,
  planetScaleBody,
  planetScaleDeployRequestSchema,
  planetScaleHeaders,
  planetScaleJson,
  planetScaleNumber,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleCloseDeployRequestTool: ToolConfig<
  PlanetScaleCloseDeployRequestParams,
  PlanetScaleToolResponse<{ deployRequest: PlanetScaleDeployRequest }>
> = {
  id: 'planetscale_close_deploy_request',
  name: 'PlanetScale Close Deploy Request',
  description: 'Close a deploy request (Vitess only)',
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
    method: 'PATCH',
    headers: planetScaleHeaders,
    body: () => planetScaleBody({ state: 'closed' }),
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
