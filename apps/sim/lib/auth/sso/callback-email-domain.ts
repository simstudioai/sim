import { createLogger } from '@sim/logger'
import { isEmailInSSODomain } from '@sim/utils/sso-domain'
import { type GenericEndpointContext, getCurrentAdapter } from 'better-auth'
import { APIError, getOAuthState } from 'better-auth/api'
import { SSO_PROVISIONING_FAILED_ERROR_CODE } from '@/lib/auth/constants'
import { isSsoCallbackPath, resolveSsoCallbackProviderId } from '@/lib/auth/sso/callback-provider'

const logger = createLogger('SsoCallbackEmailDomain')

/**
 * Refuses writing a user email at an SSO callback unless the provider's domain is verified and the
 * address belongs to it.
 *
 * Better Auth checks the provider's domain only before linking to an existing account. It creates a
 * new user (and, with `overrideUserInfo`, rewrites a linked user's email) from whatever address the
 * IdP asserts. The admission after-hook refuses such a sign-in, but only once the row has already
 * been written, so the check has to run here, in the user write's `before` hook, to keep a tenant's
 * IdP from claiming addresses in domains it never proved.
 *
 * @param context - the Better Auth endpoint context the write runs under; writes outside an SSO
 * callback pass through untouched.
 */
export async function refuseSsoCallbackEmailOutsideProviderDomain(
  email: string,
  context: GenericEndpointContext | null
): Promise<void> {
  if (!context || !isSsoCallbackPath(context.path)) return

  const providerId = resolveSsoCallbackProviderId({
    path: context.path,
    routeProviderId: context.params?.providerId,
    stateProviderId:
      context.path === '/sso/callback' ? (await getOAuthState())?.ssoProviderId : undefined,
  })
  // The write runs inside Better Auth's transaction, so the lookup joins it through its adapter.
  const adapter = await getCurrentAdapter(context.context.adapter)
  const provider = providerId
    ? await adapter.findOne<{ domain: string; domainVerified: boolean }>({
        model: 'ssoProvider',
        where: [{ field: 'providerId', value: providerId }],
        select: ['domain', 'domainVerified'],
      })
    : null

  if (provider?.domainVerified && isEmailInSSODomain(email, provider.domain)) return

  logger.warn('Refusing SSO user write for an email outside the provider domain', {
    providerId,
    path: context.path,
    providerFound: Boolean(provider),
    domainVerified: provider?.domainVerified ?? false,
  })
  // The callback redirects a refused creation with `message` and a refused update with `code`.
  throw new APIError('FORBIDDEN', {
    code: SSO_PROVISIONING_FAILED_ERROR_CODE,
    message: SSO_PROVISIONING_FAILED_ERROR_CODE,
  })
}
