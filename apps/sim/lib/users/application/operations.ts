import type { ApplicationOperation } from '@/lib/core/application'

export interface UserAccountOperation<Id extends string = string> extends ApplicationOperation<Id> {
  readonly principalKinds: readonly ['session']
}

function defineUserAccountOperation<const Id extends string>(id: Id): UserAccountOperation<Id> {
  return Object.freeze({ id, principalKinds: Object.freeze(['session'] as const) })
}

/**
 * Operations an account performs on itself. They carry no workspace scope and no
 * role: the resource *is* the authenticated principal, so a session is both the
 * only acceptable credential and the whole authorization story. That policy is
 * enforced where it can actually hold — `internalSessionAuth` on the route and
 * the principal guard in each use case — rather than restated as inert data here.
 */
export const userAccountOperations = {
  readProfile: defineUserAccountOperation('users.account.profile.read'),
  readSettings: defineUserAccountOperation('users.account.settings.read'),
  previewDeletion: defineUserAccountOperation('users.account.deletion_preview'),
  delete: defineUserAccountOperation('users.account.delete'),
} as const satisfies Record<string, UserAccountOperation>
