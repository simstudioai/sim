import type { ApplicationOperation } from '@/lib/core/application'

/**
 * Operations a credential performs on itself.
 *
 * They carry no workspace scope and no role: the resource *is* the
 * authenticated key, so holding it is the whole authorization story. That policy
 * is enforced where it can actually hold — `v2ApiKeyAuth` on the route and the
 * principal guard in the use case — rather than restated as inert data here.
 */
export const v2MetaOperations = {
  read: { id: 'meta.capabilities.read' },
} as const satisfies Record<string, ApplicationOperation>
