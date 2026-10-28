import {
  PLANETSCALE_DEPLOYREQUEST_OUTPUT_PROPERTIES,
  type PlanetScaleDeployRequest,
  type PlanetScaleQueueDeployRequestParams,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  optionalPlanetScaleBoolean,
  planetScaleApiUrl,
  planetScaleBody,
  planetScaleDeployRequestSchema,
  planetScaleHeaders,
  planetScaleJson,
  planetScaleNumber,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleQueueDeployRequestTool: ToolConfig<
  PlanetScaleQueueDeployRequestParams,
  PlanetScaleToolResponse<{ deployRequest: PlanetScaleDeployRequest }>
> = {
  id: 'planetscale_queue_deploy_request',
  name: 'PlanetScale Queue Deploy Request',
  description: 'Queue a deploy request (Vitess only)',
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
    instantDdl: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether or not to deploy the request with instant DDL. Defaults to false.',
    },
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/deploy-requests/${planetScaleNumber(params.deployRequestNumber, 'deployRequestNumber')}/deploy`,
        {}
      ),
    method: 'POST',
    headers: planetScaleHeaders,
    body: (params) =>
      planetScaleBody({ instant_ddl: optionalPlanetScaleBoolean(params.instantDdl, 'instantDdl') }),
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
