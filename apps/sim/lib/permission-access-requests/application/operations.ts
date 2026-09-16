import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

function defineAccessRequestOperation(id: string, admin = false) {
  const organizationOperation = defineOrganizationOperation({
    id,
    minimumRole: admin ? 'admin' : 'member',
    principalKinds: ['session'],
    /**
     * permission-group-exempt: reviewing and requesting withheld access must remain reachable.
     */
    capability: 'none',
  })
  const workspaceOperation = defineWorkspaceOperation({
    id,
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
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
  discover: defineAccessRequestOperation('access_requests.discover'),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  listMine: defineAccessRequestOperation('access_requests.list_mine'),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  create: defineAccessRequestOperation('access_requests.create'),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  cancel: defineAccessRequestOperation('access_requests.cancel'),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  listOrganization: defineAccessRequestOperation('access_requests.list_organization', true),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  preview: defineAccessRequestOperation('access_requests.preview', true),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  resolve: defineAccessRequestOperation('access_requests.resolve', true),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  getSettings: defineAccessRequestOperation('access_requests.get_settings', true),
  /**
   * permission-group-exempt: requesting and reviewing access must remain reachable when the requested capability is denied.
   */
  updateSettings: defineAccessRequestOperation('access_requests.update_settings', true),
} as const

export type AccessRequestOperation = ReturnType<typeof defineAccessRequestOperation>
