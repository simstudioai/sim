import type { Principal } from '@sim/auth/principal'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export type AccessRequestPrincipal = Extract<
  Principal,
  { kind: 'session' | 'personal_api_key' | 'oauth_access_token' }
>

function defineAccessRequestOperation(
  id: string,
  oauthScope: 'api:read' | 'api:write',
  admin = false
) {
  const organizationOperation = defineOrganizationOperation({
    id,
    oauthScope,
    minimumRole: admin ? 'admin' : 'member',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    /**
     * permission-group-exempt: reviewing and requesting withheld access must remain reachable.
     */
    capability: 'none',
  })
  const workspaceOperation = defineWorkspaceOperation({
    id,
    oauthScope,
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    /**
     * permission-group-exempt: requests never grant a withheld capability without administrator review.
     */
    capability: 'none',
  })
  return Object.freeze({ ...workspaceOperation, organizationOperation, admin })
}

export const accessRequestOperations = {
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  discover: defineAccessRequestOperation('access_requests.discover', 'api:read'),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  listMine: defineAccessRequestOperation('access_requests.list_mine', 'api:read'),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  create: defineAccessRequestOperation('access_requests.create', 'api:write'),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  cancel: defineAccessRequestOperation('access_requests.cancel', 'api:write'),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  listOrganization: defineAccessRequestOperation(
    'access_requests.list_organization',
    'api:read',
    true
  ),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  preview: defineAccessRequestOperation('access_requests.preview', 'api:read', true),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  resolve: defineAccessRequestOperation('access_requests.resolve', 'api:write', true),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  getSettings: defineAccessRequestOperation('access_requests.get_settings', 'api:read', true),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  updateSettings: defineAccessRequestOperation(
    'access_requests.update_settings',
    'api:write',
    true
  ),
} as const

export type AccessRequestOperation = ReturnType<typeof defineAccessRequestOperation>
