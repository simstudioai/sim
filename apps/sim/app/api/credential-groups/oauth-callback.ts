import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest, NextResponse } from 'next/server'
import type { CredentialGroupOAuthCallbackQuery } from '@/lib/api/contracts/credential-groups'
import { credentialGroupOAuthAttemptPrincipal } from '@/lib/credential-groups/application/enrollment-auth'
import { completePublicCredentialGroupOAuth } from '@/lib/credential-groups/application/public-enrollment'
import { CredentialGroupOAuthStateVersionError } from '@/lib/credential-groups/oauth-attempt-version'
import { consumeCredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import {
  CredentialGroupInvitationUnavailableError,
  CredentialGroupOAuthError,
} from '@/lib/credential-groups/provider-adapter'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import {
  type CredentialGroupOAuthFailure,
  createCredentialGroupCompletionRedirect,
  createCredentialGroupEnrollmentRedirect,
} from '@/app/api/credential-groups/enrollment-redirect'

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
    if (error instanceof CredentialGroupOAuthStateVersionError) {
      return createCredentialGroupCompletionRedirect('expired')
    }
    logger.error('Failed to consume credential group OAuth state', {
      error: getErrorMessage(error),
    })
    return createCredentialGroupCompletionRedirect('unavailable')
  }
  if (!attempt || attempt.provider !== provider) {
    return createCredentialGroupCompletionRedirect(limited ? 'rate_limited' : 'expired')
  }
  const focus: Record<string, string> = attempt.returnTo
    ? { optionId: attempt.optionId, returnTo: attempt.returnTo }
    : {}
  const failureRedirect = (oauth: CredentialGroupOAuthFailure) =>
    attempt.completionRedirect
      ? createCredentialGroupCompletionRedirect(oauth)
      : createCredentialGroupEnrollmentRedirect(attempt.invitationToken, { ...focus, oauth })
  if (limited) {
    return failureRedirect('rate_limited')
  }
  if (providerError) {
    return failureRedirect('denied')
  }
  if (!code) {
    return failureRedirect('failed')
  }

  try {
    const principal = await credentialGroupOAuthAttemptPrincipal(attempt)
    await completePublicCredentialGroupOAuth.execute({
      principal,
      input: { attempt, code },
      request,
    })
    return attempt.completionRedirect
      ? createCredentialGroupCompletionRedirect()
      : createCredentialGroupEnrollmentRedirect(attempt.invitationToken, {
          ...focus,
          connected: attempt.optionId,
        })
  } catch (error) {
    logger.error('Managed OAuth authorization failed', {
      provider,
      error: getErrorMessage(error),
    })
    const status =
      error instanceof CredentialGroupInvitationUnavailableError
        ? 'unavailable'
        : error instanceof CredentialGroupOAuthError && error.statusCode === 403
          ? error.message.startsWith('Sign in with')
            ? 'account_mismatch'
            : 'permissions_required'
          : error instanceof CredentialGroupOAuthError && error.statusCode === 409
            ? 'configuration_changed'
            : 'failed'
    return failureRedirect(status)
  }
}
