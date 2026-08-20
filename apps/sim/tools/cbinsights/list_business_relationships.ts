import type { CbInsightsListResponse, CbInsightsOrgListParams } from '@/tools/cbinsights/types'
import {
  asArray,
  cbInsightsRequest,
  compactBody,
  pageInfo,
  requireOrgIds,
} from '@/tools/cbinsights/utils'
import type { ToolConfig } from '@/tools/types'

interface CbInsightsListBusinessRelationshipsParams extends CbInsightsOrgListParams {
  nextPageToken?: string
}

export const cbinsightsListBusinessRelationshipsTool: ToolConfig<
  CbInsightsListBusinessRelationshipsParams,
  CbInsightsListResponse
> = {
  id: 'cbinsights_list_business_relationships',
  name: 'CB Insights List Business Relationships',
  description:
    'Retrieve partnerships, client/vendor relationships, and licensing activity for up to 100 organizations at once, with AI-generated insights on each.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CB Insights API client ID, exchanged for a bearer token before each call',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CB Insights API client secret, exchanged for a bearer token before each call',
    },
    orgIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'CB Insights organization IDs, 1-100 per request, e.g. [129410, 1034157]',
    },
    nextPageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Continuation token from a previous response; omit for the first page',
    },
  },

  request: { url: () => '', method: 'POST', headers: () => ({}) },

  directExecution: async (params, signal) =>
    cbInsightsRequest<{ orgs?: unknown; nextPageToken?: unknown }>(
      params,
      {
        path: '/v2/businessrelationships',
        body: compactBody({
          orgIds: requireOrgIds(params.orgIds),
          nextPageToken: params.nextPageToken,
        }),
      },
      (data) => ({ orgs: asArray(data.orgs), ...pageInfo(data) }),
      signal
    ),

  outputs: {
    orgs: {
      type: 'json',
      description: 'Organizations as [{orgId, businessRelationships}]',
    },
    nextPageToken: {
      type: 'string',
      nullable: true,
      description: 'Token for the next page, or null when there are no more results',
    },
    totalHits: {
      type: 'number',
      nullable: true,
      description: 'Total number of matching records',
    },
    totalHitsRelation: {
      type: 'string',
      nullable: true,
      description: "Whether totalHits is exact ('eq') or a floor ('gte', used above 10,000)",
    },
  },
}
