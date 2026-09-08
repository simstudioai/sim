import type { ApplicationOperation } from '@/lib/core/application'
import { assertOperationCapability } from '@/lib/core/application'

export interface UserAccountOperation<Id extends string = string> extends ApplicationOperation<Id> {
  readonly principalKinds: readonly ['session']
}

/**
 * Bakes the session-only principal policy into the operation —
 * `requireUserAccountPrincipal` reads `principalKinds` off it at authorization
 * time — and refuses a missing capability at definition time, the same guard
 * every other operation factory carries.
 */
function defineUserAccountOperation<const Id extends string>(
  operation: ApplicationOperation<Id>
): UserAccountOperation<Id> {
  assertOperationCapability(operation)
  return Object.freeze({ ...operation, principalKinds: Object.freeze(['session'] as const) })
}

/**
 * Operations an account performs on itself. They carry no workspace scope and
 * no role: the resource *is* the authenticated principal, so a session is both
 * the only acceptable credential and the whole authorization story, enforced by
 * `internalSessionAuth` on the route and `requireUserAccountPrincipal` in each
 * use case.
 */
export const userAccountOperations = {
  // permission-group-exempt: reading your own profile is not a workspace act, so no group key names it
  readProfile: defineUserAccountOperation({ id: 'users.account.profile.read', capability: 'none' }),
  // permission-group-exempt: reading your own account settings is not a workspace act, so no group key names it
  readSettings: defineUserAccountOperation({
    id: 'users.account.settings.read',
    capability: 'none',
  }),
  // permission-group-exempt: the resource is the account itself, and a permission group scopes a workspace the account may leave rather than the account
  previewDeletion: defineUserAccountOperation({
    id: 'users.account.deletion_preview',
    capability: 'none',
  }),
  // permission-group-exempt: deleting your own account is not a workspace act, so no group key names it
  delete: defineUserAccountOperation({ id: 'users.account.delete', capability: 'none' }),
  // permission-group-exempt: the apps an account has authorized belong to the account, not to any workspace a group governs
  readAuthorizedApps: defineUserAccountOperation({
    id: 'users.account.authorized_apps.read',
    capability: 'none',
  }),
  // permission-group-exempt: revoking an app's access to your own account is not a workspace act, so no group key names it
  revokeAuthorizedApp: defineUserAccountOperation({
    id: 'users.account.authorized_apps.revoke',
    capability: 'none',
  }),
} as const satisfies Record<string, UserAccountOperation>
