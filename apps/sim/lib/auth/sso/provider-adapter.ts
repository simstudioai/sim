import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import type { auth } from '@/lib/auth'
import { configuredSsoPlugin } from '@/lib/auth/sso/plugin'
import { isSsoEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'

/** Registration input accepted by the configured Better Auth SSO plugin. */
export type SsoProviderConfig = NonNullable<
  Parameters<typeof auth.api.registerSSOProvider>[0]
>['body']

/** Creates a common writer after the application operation has authorized the acting user. */
export async function ssoProviderWriter(
  principal: Principal,
  organizationId: string,
  executor: DbOrTx = db
) {
  if (
    principal.kind !== 'session' &&
    principal.kind !== 'personal_api_key' &&
    principal.kind !== 'oauth_access_token'
  )
    throw new OrchestrationError('forbidden', 'SSO provider writes require a user credential')
  if (!isSsoEnabled) throw new OrchestrationError('validation', 'SSO is not enabled')
  const userId = requirePrincipalSubjectUserId(principal)
  const { auth } = await import('@/lib/auth')
  const context = await auth.$context
  const { createSsoProviderRepository } = await import('@/lib/auth/sso/provider-repository')
  return createSsoProviderRepository(
    userId,
    organizationId,
    configuredSsoPlugin,
    {
      reservedProviderIds: [
        ...Object.keys(context.options.socialProviders ?? {}),
        ...context.socialProviders.map((provider) => provider.id),
        ...context.trustedProviders,
      ],
    },
    executor
  )
}
