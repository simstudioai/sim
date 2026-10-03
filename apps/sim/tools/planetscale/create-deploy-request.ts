import {
  PLANETSCALE_DEPLOYREQUEST_OUTPUT_PROPERTIES,
  type PlanetScaleCreateDeployRequestParams,
  type PlanetScaleDeployRequest,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  optionalPlanetScaleBoolean,
  optionalPlanetScaleString,
  planetScaleApiUrl,
  planetScaleBody,
  planetScaleDeployRequestSchema,
  planetScaleHeaders,
  planetScaleJson,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleCreateDeployRequestTool: ToolConfig<
  PlanetScaleCreateDeployRequestParams,
  PlanetScaleToolResponse<{ deployRequest: PlanetScaleDeployRequest }>
> = {
  id: 'planetscale_create_deploy_request',
  name: 'PlanetScale Create Deploy Request',
  description: 'Create a deploy request (Vitess only)',
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
    branch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the branch the deploy request is created from',
    },
    intoBranch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the branch the deploy request will be merged into',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notes about the deploy request',
    },
    autoCutover: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether or not to enable auto_cutover for the deploy request. When enabled, will auto cutover to the new schema as soon as it is ready.',
    },
    autoDeleteBranch: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether or not to enable auto_delete_branch for the deploy request. When enabled, will delete the branch once the DR successfully completes.',
    },
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/deploy-requests`,
        {}
      ),
    method: 'POST',
    headers: planetScaleHeaders,
    body: (params) =>
      planetScaleBody({
        branch: params.branch,
        into_branch: params.intoBranch,
        notes: optionalPlanetScaleString(params.notes, 'notes'),
        auto_cutover: optionalPlanetScaleBoolean(params.autoCutover, 'autoCutover'),
        auto_delete_branch: optionalPlanetScaleBoolean(params.autoDeleteBranch, 'autoDeleteBranch'),
      }),
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
