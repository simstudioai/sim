import type {
  DelegatedPrincipal,
  OrganizationDelegatedPrincipal,
  Principal,
} from '@sim/auth/principal'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/**
 * Chat acting for the requester joins the direct callers on the workspace routes, and Chat acting
 * for an organization administrator joins them on review.
 */
export type AccessRequestPrincipal =
  | Extract<Principal, { kind: 'session' | 'personal_api_key' | 'oauth_access_token' }>
  | (DelegatedPrincipal & { serviceId: 'copilot' })
  | (OrganizationDelegatedPrincipal & { serviceId: 'copilot' })

export const ACCESS_REQUEST_DELEGATION_AUDIENCE = 'sim:settings'

const DIRECT_CALLERS = ['session', 'personal_api_key', 'oauth_access_token'] as const

/** Review admits Chat acting for an organization administrator, under the settings audience. */
const CHAT_REVIEW_POLICY = {
  principalKinds: [...DIRECT_CALLERS, 'organization_delegated'],
  delegationAudience: ACCESS_REQUEST_DELEGATION_AUDIENCE,
  delegatedServices: ['copilot'],
  contentDelivery: 'none',
} as const

function defineAccessRequestOperation(
  id: string,
  oauthScope: 'api:read' | 'api:write',
  audience: 'member' | 'admin' | 'review' = 'member'
) {
  const admin = audience !== 'member'
  const organizationOperation = defineOrganizationOperation({
    id,
    oauthScope,
    minimumRole: admin ? 'admin' : 'member',
    ...(audience === 'review' ? CHAT_REVIEW_POLICY : { principalKinds: DIRECT_CALLERS }),
    /**
     * permission-group-exempt: reviewing and requesting withheld access must remain reachable.
     */
    capability: 'none',
  })
  /**
   * A member's own requests admit Chat delegated by that member through a workspace. Review is
   * organization-scoped, so Chat reaches it only through an organization conversation; request
   * settings stay with direct callers.
   */
  const workspaceOperation = admin
    ? defineWorkspaceOperation({
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
    : defineWorkspaceOperation({
        id,
        oauthScope,
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
        delegatedServices: ['copilot'],
        /**
         * permission-group-exempt: requests never grant a withheld capability without administrator review.
         */
        capability: 'none',
        contentDelivery: 'none',
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
    'review'
  ),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  preview: defineAccessRequestOperation('access_requests.preview', 'api:read', 'review'),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  resolve: defineAccessRequestOperation('access_requests.resolve', 'api:write', 'review'),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  getSettings: defineAccessRequestOperation('access_requests.get_settings', 'api:read', 'admin'),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  updateSettings: defineAccessRequestOperation(
    'access_requests.update_settings',
    'api:write',
    'admin'
  ),
} as const

export type AccessRequestOperation = ReturnType<typeof defineAccessRequestOperation>
