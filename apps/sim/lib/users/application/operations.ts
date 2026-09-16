import type { ApplicationOperation } from '@/lib/core/application'
import { assertOperationCapability } from '@/lib/core/application'

export interface UserAccountOperation<Id extends string = string> extends ApplicationOperation<Id> {
  readonly principalKinds: readonly ('session' | 'delegated' | 'organization_delegated')[]
  readonly delegationAudience?: string
}

/**
 * Account operations remain session-only unless durable profile/preferences
 * explicitly opt into bounded Copilot delegation.
 */
function defineUserAccountOperation<const Id extends string>(
  operation: ApplicationOperation<Id>,
  allowPreferencesDelegation = false
): UserAccountOperation<Id> {
  assertOperationCapability(operation)
  if (allowPreferencesDelegation)
    return Object.freeze({
      ...operation,
      principalKinds: Object.freeze(['session', 'delegated', 'organization_delegated'] as const),
      delegationAudience: 'sim:settings',
    })
  return Object.freeze({ ...operation, principalKinds: Object.freeze(['session'] as const) })
}

/**
 * Operations an account performs on itself. Delegated preference operations
 * recheck the hosting conversation's membership and act only on its human subject.
 * Destructive account and grant-management operations still require a session.
 */
export const userAccountOperations = {
  // permission-group-exempt: reading your own profile is not a workspace act, so no group key names it
  readProfile: defineUserAccountOperation(
    { id: 'users.account.profile.read', capability: 'none' },
    true
  ),
  // permission-group-exempt: reading your own account settings is not a workspace act, so no group key names it
  readSettings: defineUserAccountOperation(
    {
      id: 'users.account.settings.read',
      capability: 'none',
    },
    true
  ),
  /** permission-group-exempt: a person changes their own profile, not an organization's resource. */
  updateProfile: defineUserAccountOperation(
    { id: 'users.account.profile.update', capability: 'none' },
    true
  ),
  /** permission-group-exempt: durable account preferences belong to the acting person. */
  updateSettings: defineUserAccountOperation(
    { id: 'users.account.settings.update', capability: 'none' },
    true
  ),
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
