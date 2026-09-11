import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import type { CredentialGroupOAuthCallbackQuery } from '@/lib/api/contracts/credential-groups'
import { internalSessionAuth } from '@/lib/api/server/routes'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { credentialGroupOAuthAttemptPrincipal } from '@/lib/credential-groups/application/enrollment-auth'
import { completePublicCredentialGroupOAuth } from '@/lib/credential-groups/application/public-enrollment'
import { CredentialGroupOAuthStateVersionError } from '@/lib/credential-groups/oauth-attempt-version'
import type { CredentialGroupOAuthFailure } from '@/lib/credential-groups/oauth-completion'
import { consumeCredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import {
  CredentialGroupInvitationUnavailableError,
  CredentialGroupOAuthError,
  CredentialGroupProviderConfigurationError,
} from '@/lib/credential-groups/provider-adapter'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import { completeGitHubSetupReaderOAuth } from '@/lib/knowledge/application/github-setup'
import { githubSetupContinueUrl } from '@/lib/knowledge/github-setup-urls'
import {
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
  const setupRedirect = (oauth?: CredentialGroupOAuthFailure) =>
    new NextResponse(null, {
      status: 303,
      headers: {
        Location: githubSetupContinueUrl(
          { organizationId: attempt.organizationId!, setupId: attempt.completionId! },
          oauth
        ),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    })
  const installationSetup =
    attempt.returnTo === 'github-installation' && attempt.organizationId && attempt.completionId
  const failureRedirect = (oauth: CredentialGroupOAuthFailure) =>
    installationSetup
      ? setupRedirect(oauth)
      : attempt.completionRedirect
        ? createCredentialGroupCompletionRedirect(oauth, attempt.completionId)
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
    if (installationSetup) {
      const principal = await internalSessionAuth.authenticate()
      await completeGitHubSetupReaderOAuth.execute({ principal, input: { attempt, code }, request })
      return setupRedirect()
    }
    const principal = await credentialGroupOAuthAttemptPrincipal(attempt)
    await completePublicCredentialGroupOAuth.execute({
      principal,
      input: { attempt, code },
      request,
    })
    return attempt.completionRedirect
      ? createCredentialGroupCompletionRedirect(undefined, attempt.completionId)
      : createCredentialGroupEnrollmentRedirect(attempt.invitationToken, {
          ...focus,
          connected: attempt.optionId,
        })
  } catch (error) {
    const identityFailure =
      error instanceof CredentialGroupOAuthError ? error.identityFailure : undefined
    let status: CredentialGroupOAuthFailure =
      error instanceof CredentialGroupInvitationUnavailableError
        ? 'unavailable'
        : error instanceof CredentialGroupOAuthError && error.statusCode === 403
          ? error.message.startsWith('Sign in with')
            ? 'account_mismatch'
            : 'permissions_required'
          : error instanceof CredentialGroupOAuthError && error.statusCode === 409
            ? 'configuration_changed'
            : 'failed'
    if (identityFailure) {
      switch (identityFailure.reason) {
        case 'email_mismatch':
          status = provider === 'github-repositories' ? 'github_email_mismatch' : 'account_mismatch'
          break
        case 'email_access_denied':
          status =
            provider === 'github-repositories'
              ? 'github_email_access_denied'
              : 'permissions_required'
          break
        case 'rate_limited':
          status = 'rate_limited'
          break
        case 'provider_unavailable':
        case 'invalid_response':
          status = 'provider_unavailable'
          break
      }
    }
    const applicationError = asOrchestrationError(error)
    logger.error('Managed OAuth authorization failed', {
      provider,
      failure: status,
      errorClass:
        error instanceof CredentialGroupInvitationUnavailableError
          ? 'invitation_unavailable'
          : error instanceof CredentialGroupOAuthError
            ? 'credential_group_oauth'
            : error instanceof CredentialGroupProviderConfigurationError
              ? 'provider_configuration'
              : applicationError
                ? 'application'
                : 'unexpected',
      ...(error instanceof CredentialGroupOAuthError && { statusCode: error.statusCode }),
      ...(error instanceof CredentialGroupProviderConfigurationError && { statusCode: 503 }),
      ...(applicationError && {
        applicationCode: applicationError.code,
        statusCode: statusForOrchestrationError(applicationError.code),
      }),
      ...(identityFailure && {
        identityReason: identityFailure.reason,
        identityStage: identityFailure.stage,
        providerStatus: identityFailure.httpStatus,
      }),
    })
    return failureRedirect(status)
  }
}
