import type {
  CbInsightsOrgListParams,
  CbInsightsPagedOrgListResponse,
} from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export interface CbInsightsListBusinessRelationshipsParams extends CbInsightsOrgListParams {
  nextPageToken?: string
}

export const cbinsightsListBusinessRelationshipsTool: InternalToolConfig<
  CbInsightsListBusinessRelationshipsParams,
  CbInsightsPagedOrgListResponse
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

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    orgs: {
      type: 'json',
      description: 'Organizations as [{orgId, businessRelationships}]',
    },
    /*
     * This is the one paged endpoint that reports no total: the documented
     * response carries `orgs` and `nextPageToken` only, so declaring `totalHits`
     * here would promise a field that is always null.
     */
    nextPageToken: {
      type: 'string',
      nullable: true,
      description: 'Token for the next page, or null when there are no more results',
    },
  },
}
