import type { sso } from '@better-auth/sso'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import type { BetterAuthPlugin } from 'better-auth'
import type { auth } from '@/lib/auth'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'

export type SsoProviderConfig = NonNullable<
  Parameters<typeof auth.api.registerSSOProvider>[0]
>['body']

function isSsoPlugin(plugin: BetterAuthPlugin): plugin is ReturnType<typeof sso> {
  return plugin.id === 'sso'
}

/** Selects a writer after the application operation has authorized the acting user. */
export async function ssoProviderWriter(
  principal: Principal,
  organizationId: string,
  request?: OrchestrationRequestContext
) {
  const { auth } = await import('@/lib/auth')
  if (principal.kind === 'session') {
    return {
      register: (body: SsoProviderConfig) =>
        auth.api.registerSSOProvider({
          body,
          headers: request?.headers instanceof Headers ? request.headers : undefined,
        }),
      update: (body: NonNullable<Parameters<typeof auth.api.updateSSOProvider>[0]>['body']) =>
        auth.api.updateSSOProvider({
          body,
          headers: request?.headers instanceof Headers ? request.headers : undefined,
        }),
    }
  }
  if (principal.kind !== 'personal_api_key' && principal.kind !== 'oauth_access_token')
    throw new OrchestrationError('forbidden', 'SSO provider writes require a user credential')
  const userId = requirePrincipalSubjectUserId(principal)
  const plugins: readonly BetterAuthPlugin[] = auth.options.plugins ?? []
  const plugin = plugins.find(isSsoPlugin)
  if (!plugin) throw new OrchestrationError('validation', 'SSO is not enabled')
  const context = await auth.$context
  const { createSsoProviderRepository } = await import('@/lib/auth/sso/provider-repository')
  return createSsoProviderRepository(userId, organizationId, plugin, {
    reservedProviderIds: [
      ...Object.keys(context.options.socialProviders ?? {}),
      ...context.socialProviders.map((provider) => provider.id),
      ...context.trustedProviders,
    ],
    hasScimProvider: async (providerId) =>
      context.hasPlugin('scim') &&
      Boolean(
        await context.adapter.findOne({
          model: 'scimProvider',
          where: [{ field: 'providerId', value: providerId }],
        })
      ),
  })
}
