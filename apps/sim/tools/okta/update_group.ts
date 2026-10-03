import type { OktaUpdateGroupParams, OktaUpdateGroupResponse } from '@/tools/okta/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const oktaUpdateGroupTool: InternalToolConfig<
  OktaUpdateGroupParams,
  OktaUpdateGroupResponse
> = {
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
  operation: {
    input: createInternalToolOperationInput,
  },

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
