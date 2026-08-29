import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsLookupOrganizationsParams } from '@/tools/cbinsights/lookup_organizations'
import {
  asArray,
  cbInsightsRequest,
  clampLimit,
  compactBody,
  pageInfo,
  parseOptionalStringParam,
  parseStringListParam,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsLookupOrganizationsOperation: InternalToolOperationImplementation<
  CbInsightsLookupOrganizationsParams
> = async (params, signal) => {
  const names = parseStringListParam(params.names, 'names')
  const urls = parseStringListParam(params.urls, 'urls')
  const profileUrl = parseOptionalStringParam(params.profileUrl, 'profileUrl')

  if (!names && !urls && !profileUrl) {
    throw new Error('CB Insights lookup requires at least one of "names", "urls", or "profileUrl"')
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
        nextPageToken: parseOptionalStringParam(params.nextPageToken, 'nextPageToken'),
      }),
    },
    (data) => ({ orgs: asArray(data.orgs), ...pageInfo(data) }),
    signal
  )
}
