import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaGroup, OktaUpdateGroupParams, OktaUpdateGroupResponse } from '@/tools/okta/types'
import { mergeOktaGroupProfile, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated group name. Leave blank to keep the stored name',
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
  },

  /**
   * Unreachable fallback, kept only because `ToolConfig` requires a `request`.
   *
   * The executor always prefers `directExecution` for this tool. If that ever
   * changed, this path could not read the stored profile first, so the `PUT`
   * would replace an extensible profile with the two fields the caller
   * supplied — erasing the stored description on a rename and every org-defined
   * custom attribute. Failing loudly is the only safe behavior; silently
   * truncating the profile is not.
   */
  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/groups/${safeUrlPathSegment(params.groupId, 'groupId')}`
    },
    method: 'PUT',
    headers: (params) => oktaHeaders(params.apiKey),
    body: () => {
      throw new Error(
        'Okta update_group requires direct execution: replacing a group profile without reading it first would erase the stored description and every custom attribute'
      )
    },
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
