import type { CbInsightsAuthParams, CbInsightsListResponse } from '@/tools/cbinsights/types'
import {
  asArray,
  cbInsightsRequest,
  clampLimit,
  compactBody,
  pageInfo,
  parseStringListParam,
} from '@/tools/cbinsights/utils'
import type { ToolConfig } from '@/tools/types'

interface CbInsightsLookupOrganizationsParams extends CbInsightsAuthParams {
  names?: string[] | string
  urls?: string[] | string
  profileUrl?: string
  limit?: number | string
  nextPageToken?: string
}

export const cbinsightsLookupOrganizationsTool: ToolConfig<
  CbInsightsLookupOrganizationsParams,
  CbInsightsListResponse
> = {
  id: 'cbinsights_lookup_organizations',
  name: 'CB Insights Look Up Organizations',
  description:
    'Resolve company names or websites to CB Insights organization IDs. This endpoint never charges credits, so use it to match your own records before spending credits on the data endpoints.',
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
    names: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization names to look up, e.g. ["CB Insights"]',
    },
    urls: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization websites to look up, e.g. ["cbinsights.com"]',
    },
    profileUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A CB Insights profile URL to resolve. Mutually exclusive with names and urls — the API rejects a request that sets both.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rows to return in a single response, 1-100',
    },
    nextPageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Continuation token from a previous response; omit for the first page',
    },
  },

  request: { url: () => '', method: 'POST', headers: () => ({}) },

  directExecution: async (params, signal) => {
    const names = parseStringListParam(params.names, 'names')
    const urls = parseStringListParam(params.urls, 'urls')
    const profileUrl = params.profileUrl?.trim()

    if (!names && !urls && !profileUrl) {
      throw new Error(
        'CB Insights lookup requires at least one of "names", "urls", or "profileUrl"'
      )
    }
    if (profileUrl && (names || urls)) {
      throw new Error(
        'CB Insights rejects "profileUrl" combined with "names" or "urls" — pass only one'
      )
    }

    return cbInsightsRequest<{
      orgs?: unknown
      nextPageToken?: unknown
      totalHits?: unknown
      totalHitsRelation?: unknown
    }>(
      params,
      {
        path: '/v2/organizations',
        body: compactBody({
          names,
          urls,
          profileUrl,
          limit: clampLimit(params.limit),
          nextPageToken: params.nextPageToken?.trim(),
        }),
      },
      (data) => ({ orgs: asArray(data.orgs), ...pageInfo(data) }),
      signal
    )
  },

  outputs: {
    orgs: {
      type: 'json',
      description: 'Matched organizations as [{orgId, name, description, aliases, urls}]',
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
