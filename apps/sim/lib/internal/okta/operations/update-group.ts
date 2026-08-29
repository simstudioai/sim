import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OktaGroup, OktaUpdateGroupParams, OktaUpdateGroupResponse } from '@/tools/okta/types'
import { mergeOktaGroupProfile, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaUpdateGroup')

async function transformUpdateGroupResponse(response: Response): Promise<OktaUpdateGroupResponse> {
  if (!response.ok) {
    await throwOktaError(response, logger, 'Failed to update group in Okta')
  }

  const group: OktaGroup = await response.json()
  return {
    success: true,
    output: {
      id: group.id,
      name: group.profile?.name ?? '',
      description: group.profile?.description ?? null,
      type: group.type,
      created: group.created,
      lastUpdated: group.lastUpdated,
      lastMembershipUpdated: group.lastMembershipUpdated ?? null,
      success: true,
    },
  }
}

export const executeOktaUpdateGroupOperation: InternalToolOperationImplementation<
  OktaUpdateGroupParams
> = async (params, signal): Promise<OktaUpdateGroupResponse> => {
  const domain = validateOktaDomain(params.domain)
  const url = `https://${domain}/api/v1/groups/${safeUrlPathSegment(params.groupId, 'groupId')}`
  const headers = oktaHeaders(params.apiKey)

  const readResponse = await fetch(url, { headers, signal })
  if (!readResponse.ok) {
    await throwOktaError(readResponse, logger, 'Failed to load group for update in Okta')
  }
  const existing: OktaGroup = await readResponse.json()

  const writeResponse = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ profile: mergeOktaGroupProfile(existing.profile, params) }),
    signal,
  })

  return transformUpdateGroupResponse(writeResponse)
}
