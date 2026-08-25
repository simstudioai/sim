import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { CredentialGroupOAuthCallbackQuery } from '@/lib/api/contracts/credential-groups'
import { authenticateCredentialGroupEnrollment } from '@/lib/credential-groups/application/enrollment-auth'
import { completePublicCredentialGroupOAuth } from '@/lib/credential-groups/application/public-enrollment'
import { consumeCredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import { CredentialGroupOAuthError } from '@/lib/credential-groups/provider-adapter'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import { createCredentialGroupEnrollmentRedirect } from '@/app/api/credential-groups/enrollment-redirect'

const logger = createLogger('CredentialGroupOAuthCallbackAPI')

interface HandleCredentialGroupOAuthCallbackParams {
  request: NextRequest
  provider: CredentialGroupProvider
  query: CredentialGroupOAuthCallbackQuery
  limited: NextResponse | null
}

/** Completes a parsed managed-enrollment callback from the provider's configured callback route. */
export async function handleCredentialGroupOAuthCallback({
  request,
  provider,
  query,
  limited,
}: HandleCredentialGroupOAuthCallbackParams): Promise<NextResponse> {
  const { state, code, error: providerError } = query
  let attempt
  try {
    attempt = await consumeCredentialGroupOAuthAttempt(state)
  } catch (error) {
    logger.error('Failed to consume credential group OAuth state', {
      error: getErrorMessage(error),
    })
    return NextResponse.json(
      { error: 'Authorization state is unavailable. Please try again.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
  if (!attempt || attempt.provider !== provider) {
    if (limited) return limited
    return NextResponse.json(
      { error: 'Authorization state is invalid or expired.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }
  if (limited) {
    return createCredentialGroupEnrollmentRedirect(attempt.invitationToken, {
      oauth: 'rate_limited',
    })
  }
  if (providerError) {
    return createCredentialGroupEnrollmentRedirect(attempt.invitationToken, { oauth: 'denied' })
  }
  if (!code) {
    return createCredentialGroupEnrollmentRedirect(attempt.invitationToken, { oauth: 'failed' })
  }

  const principal = await authenticateCredentialGroupEnrollment(attempt.invitationToken)
  if (!principal) {
    return createCredentialGroupEnrollmentRedirect(attempt.invitationToken, {
      oauth: 'unavailable',
    })
  }

  try {
    await completePublicCredentialGroupOAuth.execute({
      principal,
      input: { attempt, code },
      request,
    })
    return createCredentialGroupEnrollmentRedirect(attempt.invitationToken, {
      connected: attempt.optionId,
    })
  } catch (error) {
    logger.error('Managed OAuth authorization failed', {
      provider,
      error: getErrorMessage(error),
    })
    const status =
      error instanceof CredentialGroupOAuthError && error.statusCode === 403
        ? error.message.startsWith('Sign in with')
          ? 'account_mismatch'
          : 'permissions_required'
        : error instanceof CredentialGroupOAuthError && error.statusCode === 409
          ? 'configuration_changed'
          : 'failed'
    return createCredentialGroupEnrollmentRedirect(attempt.invitationToken, { oauth: status })
  }
}
