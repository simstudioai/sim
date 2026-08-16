import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaGroup, OktaUpdateGroupParams, OktaUpdateGroupResponse } from '@/tools/okta/types'
import { mergeOktaGroupProfile, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('OktaUpdateGroup')

/** Shared by the direct-execution and declarative paths so both emit one shape. */
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

export const oktaUpdateGroupTool: ToolConfig<OktaUpdateGroupParams, OktaUpdateGroupResponse> = {
  id: 'okta_update_group',
  name: 'Update Group in Okta',
  description:
    'Update a group profile in your Okta organization. Only groups of OKTA_GROUP type can be updated. Fields left blank keep their stored value.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta API token for authentication',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta domain (e.g., dev-123456.okta.com)',
    },
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group ID to update',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Updated group name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated group description',
    },
  },

  /**
   * Authoritative path: read the stored profile, overlay the supplied fields,
   * then replace.
   *
   * `PUT /api/v1/groups/{groupId}` is `replaceGroup` — it swaps the profile
   * wholesale rather than merging, and the profile is extensible. Sending only
   * the two fields this tool exposes therefore erased the stored description on
   * every rename, along with any custom attribute the org had defined. Reading
   * first is the only way an omitted field can mean "leave it alone".
   */
  directExecution: async (params, signal): Promise<ToolResponse> => {
    const domain = validateOktaDomain(params.domain)
    const url = `https://${domain}/api/v1/groups/${encodeURIComponent(params.groupId.trim())}`
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
  },

  /**
   * Declarative fallback used only when direct execution is bypassed. It cannot
   * merge, so it sends exactly what the caller supplied.
   */
  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/groups/${encodeURIComponent(params.groupId.trim())}`
    },
    method: 'PUT',
    headers: (params) => oktaHeaders(params.apiKey),
    body: (params) => ({ profile: mergeOktaGroupProfile(undefined, params) }),
  },

  transformResponse: (response: Response) => transformUpdateGroupResponse(response),

  outputs: {
    id: { type: 'string', description: 'Group ID' },
    name: { type: 'string', description: 'Group name' },
    description: { type: 'string', description: 'Group description', optional: true },
    type: { type: 'string', description: 'Group type' },
    created: { type: 'string', description: 'Creation timestamp' },
    lastUpdated: { type: 'string', description: 'Last update timestamp' },
    lastMembershipUpdated: {
      type: 'string',
      description: 'Last membership change timestamp',
      optional: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
