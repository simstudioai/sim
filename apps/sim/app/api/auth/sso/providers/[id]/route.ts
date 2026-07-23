import { withSSOProviderMutationLock } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { deleteSsoProviderContract, updateSsoProviderContract } from '@/lib/api/contracts/auth'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { auth, getSession } from '@/lib/auth'
import {
  assertSSOProviderAvailable,
  assertSSOProviderHasNoAccountLinks,
  buildSSOProviderConfiguration,
  collectAuthHeaders,
  getManagedSSOProvider,
  requireNormalizedSSODomain,
  SSOManagementError,
  ssoManagementErrorResponse,
} from '@/lib/auth/sso/management'
import { env, isTruthy } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SSOProviderRoute')

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    if (!env.SSO_ENABLED) {
      return NextResponse.json({ error: 'SSO is not enabled' }, { status: 400 })
    }
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(updateSsoProviderContract, request, context, {
      validationErrorResponse: (error) =>
        NextResponse.json(
          { error: getValidationErrorMessage(error, 'Validation failed') },
          { status: 400 }
        ),
    })
    if (!parsed.success) return parsed.response

    const provider = await getManagedSSOProvider(parsed.data.params.id, session.user.id)
    const body = parsed.data.body
    const isSamlProvider = Boolean(provider.samlConfig)
    if (isSamlProvider !== 'entryPoint' in body) {
      throw new SSOManagementError('Provider type cannot be changed', 400, 'SSO_TYPE_IMMUTABLE')
    }

    const domain = requireNormalizedSSODomain(body.domain, provider.domain)
    const changesProviderIdentity = domain !== provider.domain || body.issuer !== provider.issuer
    if (changesProviderIdentity) {
      await assertSSOProviderHasNoAccountLinks(provider.providerId)
    }
    await assertSSOProviderAvailable({
      providerId: provider.providerId,
      domain,
      organizationId: provider.organizationId!,
      excludeRowId: provider.id,
    })

    const providerConfig = await buildSSOProviderConfiguration(
      { ...body, domain },
      {
        providerId: provider.providerId,
        existingConfig: isSamlProvider ? provider.samlConfig : provider.oidcConfig,
        existingIssuer: provider.issuer,
        existingDomain: provider.domain,
      }
    )
    const mutation = await withSSOProviderMutationLock(async () => {
      const currentProvider = await getManagedSSOProvider(parsed.data.params.id, session.user.id)
      const currentIsSamlProvider = Boolean(currentProvider.samlConfig)
      if (currentIsSamlProvider !== 'entryPoint' in body) {
        throw new SSOManagementError('Provider type cannot be changed', 400, 'SSO_TYPE_IMMUTABLE')
      }

      const configurationSourceChanged =
        currentProvider.issuer !== provider.issuer ||
        currentProvider.domain !== provider.domain ||
        currentProvider.oidcConfig !== provider.oidcConfig ||
        currentProvider.samlConfig !== provider.samlConfig
      if (configurationSourceChanged) {
        throw new SSOManagementError(
          'The SSO provider changed while this update was being prepared. Reload and try again.',
          409,
          'SSO_PROVIDER_CHANGED'
        )
      }

      const currentDomain = requireNormalizedSSODomain(body.domain, currentProvider.domain)
      if (currentDomain !== currentProvider.domain || body.issuer !== currentProvider.issuer) {
        await assertSSOProviderHasNoAccountLinks(currentProvider.providerId)
      }
      await assertSSOProviderAvailable({
        providerId: currentProvider.providerId,
        domain: currentDomain,
        organizationId: currentProvider.organizationId!,
        excludeRowId: currentProvider.id,
      })

      const updated = await auth.api.updateSSOProvider({
        body: { ...providerConfig, domain: currentDomain },
        headers: collectAuthHeaders(request),
      })
      return {
        updated,
        provider: currentProvider,
        domain: currentDomain,
        isSamlProvider: currentIsSamlProvider,
      }
    })

    logger.info('SSO provider updated', {
      providerId: mutation.provider.providerId,
      providerType: mutation.isSamlProvider ? 'saml' : 'oidc',
      domain: mutation.domain,
      organizationId: mutation.provider.organizationId,
    })

    return NextResponse.json({
      success: true,
      providerId: mutation.provider.providerId,
      providerType: mutation.isSamlProvider ? ('saml' as const) : ('oidc' as const),
      domainVerified: isTruthy(env.SSO_DOMAIN_VERIFICATION_ENABLED)
        ? mutation.updated.domainVerified
        : true,
      message: 'SSO provider updated successfully',
    })
  } catch (error) {
    const managedResponse = ssoManagementErrorResponse(error)
    if (managedResponse) return managedResponse
    logger.error('Failed to update SSO provider', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json({ error: 'Failed to update SSO provider' }, { status: 500 })
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    if (!env.SSO_ENABLED) {
      return NextResponse.json({ error: 'SSO is not enabled' }, { status: 400 })
    }
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(deleteSsoProviderContract, request, context)
    if (!parsed.success) return parsed.response

    const provider = await withSSOProviderMutationLock(async () => {
      const currentProvider = await getManagedSSOProvider(parsed.data.params.id, session.user.id, {
        requireEnterprise: false,
      })
      await assertSSOProviderHasNoAccountLinks(currentProvider.providerId)
      await auth.api.deleteSSOProvider({
        body: { providerId: currentProvider.providerId },
        headers: collectAuthHeaders(request),
      })
      return currentProvider
    })

    logger.info('SSO provider deleted', {
      providerId: provider.providerId,
      organizationId: provider.organizationId,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    const managedResponse = ssoManagementErrorResponse(error)
    if (managedResponse) return managedResponse
    logger.error('Failed to delete SSO provider', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json({ error: 'Failed to delete SSO provider' }, { status: 500 })
  }
})
