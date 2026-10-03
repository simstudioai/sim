import {
  PLANETSCALE_REVIEW_OUTPUT_PROPERTIES,
  type PlanetScaleReview,
  type PlanetScaleReviewDeployRequestParams,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  optionalPlanetScaleEnum,
  optionalPlanetScaleString,
  planetScaleApiUrl,
  planetScaleBody,
  planetScaleHeaders,
  planetScaleJson,
  planetScaleNumber,
  planetScaleReviewSchema,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleReviewDeployRequestTool: ToolConfig<
  PlanetScaleReviewDeployRequestParams,
  PlanetScaleToolResponse<{ review: PlanetScaleReview }>
> = {
  id: 'planetscale_review_deploy_request',
  name: 'PlanetScale Review Deploy Request',
  description: 'Review a deploy request (Vitess only)',
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
      description: 'The name of the database the deploy request belongs to',
    },
    deployRequestNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The number of the deploy request',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the review is a comment or approval. Service tokens must have corresponding access (either `approve_deploy_request` or `review_deploy_request`)',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deploy request review comments',
    },
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/deploy-requests/${planetScaleNumber(params.deployRequestNumber, 'deployRequestNumber')}/reviews`,
        {}
      ),
    method: 'POST',
    headers: planetScaleHeaders,
    body: (params) =>
      planetScaleBody({
        state: optionalPlanetScaleEnum(params.state, 'state', ['commented', 'approved']),
        body: optionalPlanetScaleString(params.body, 'body'),
      }),
  },
  transformResponse: async (response) => ({
    success: true,
    output: { review: planetScaleReviewSchema.parse(await planetScaleJson(response)) },
  }),
  outputs: {
    review: {
      type: 'json',
      description: 'Review details',
      properties: PLANETSCALE_REVIEW_OUTPUT_PROPERTIES,
    },
  },
}
