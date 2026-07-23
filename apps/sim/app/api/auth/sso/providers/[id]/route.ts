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
    if (domain !== provider.domain || body.issuer !== provider.issuer) {
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
    const updated = await auth.api.updateSSOProvider({
      body: providerConfig,
      headers: collectAuthHeaders(request),
    })

    logger.info('SSO provider updated', {
      providerId: provider.providerId,
      providerType: isSamlProvider ? 'saml' : 'oidc',
      domain,
      organizationId: provider.organizationId,
    })

    return NextResponse.json({
      success: true,
      providerId: provider.providerId,
      providerType: isSamlProvider ? ('saml' as const) : ('oidc' as const),
      domainVerified: isTruthy(env.SSO_DOMAIN_VERIFICATION_ENABLED) ? updated.domainVerified : true,
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

    const provider = await getManagedSSOProvider(parsed.data.params.id, session.user.id)
    await assertSSOProviderHasNoAccountLinks(provider.providerId)
    await auth.api.deleteSSOProvider({
      body: { providerId: provider.providerId },
      headers: collectAuthHeaders(request),
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
