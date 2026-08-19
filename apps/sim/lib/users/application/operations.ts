import type { ApplicationOperation } from '@/lib/core/application'

/**
 * Operations an account performs on itself. They carry no workspace scope and no
 * role: the resource *is* the authenticated principal, so a session is both the
 * only acceptable credential and the whole authorization story. That policy is
 * enforced where it can actually hold — `internalSessionAuth` on the route and
 * the principal guard in each use case — rather than restated as inert data here.
 */
export const userAccountOperations = {
  previewDeletion: { id: 'users.account.deletion_preview' },
  delete: { id: 'users.account.delete' },
} as const satisfies Record<string, ApplicationOperation>
