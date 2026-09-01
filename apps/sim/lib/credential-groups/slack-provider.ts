import { normalizeEmail } from '@sim/utils/string'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type {
  CredentialGroupProviderAdapter,
  CredentialGroupProviderPolicy,
} from '@/lib/credential-groups/provider-adapter'
import {
  CredentialGroupOAuthError,
  CredentialGroupProviderConfigurationError,
  credentialGroupScopePolicyVersion,
} from '@/lib/credential-groups/provider-adapter'
import { getSlackCredentialGroupConfiguration } from '@/lib/credential-groups/provider-configuration'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import {
  SLACK_MANAGED_USER_ENROLLMENT_CALLBACK_PATH,
  SLACK_MANAGED_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import {
  exchangeSlackUserAuthorization,
  getSlackCustomBotCredential,
  revokeSlackToken,
  verifySlackUserIdentity,
} from '@/lib/credential-groups/slack-managed-users'
import type { DbOrTx } from '@/lib/db/types'

const PROVIDER = 'slack' as const

async function getSlackPolicy(params: {
  workspaceId: string
  credentialGroupId: string
  slackBotCredentialId?: string
  executor?: DbOrTx
}): Promise<
  CredentialGroupProviderPolicy & {
    slackBotCredentialId: string
    clientId: string
    clientSecret: string
    appId: string
    teamId: string
  }
> {
  const managed = await getSlackCredentialGroupConfiguration({
    workspaceId: params.workspaceId,
    credentialGroupId: params.credentialGroupId,
    ...(params.executor ? { executor: params.executor } : {}),
  })
  if (!managed) {
    throw new CredentialGroupProviderConfigurationError('Configure Slack on this Credential Group')
  }
  if (params.slackBotCredentialId && managed.slackBotCredentialId !== params.slackBotCredentialId) {
    throw new CredentialGroupProviderConfigurationError(
      'The selected custom Slack bot does not match this Credential Group configuration'
    )
  }
  const app = await getSlackCustomBotCredential({
    workspaceId: params.workspaceId,
    credentialId: managed.slackBotCredentialId,
    ...(params.executor ? { executor: params.executor } : {}),
  })
  if (!app) {
    throw new CredentialGroupProviderConfigurationError(
      'The selected custom Slack bot is unavailable'
    )
  }
  if (app.teamId !== managed.teamId) {
    throw new CredentialGroupProviderConfigurationError(
      'The custom Slack bot no longer belongs to the configured Slack workspace'
    )
  }
  const service = getCredentialGroupProviderService(PROVIDER)
  const requiredScopes = [...SLACK_MANAGED_USER_SCOPES]
  const scopeVersion = credentialGroupScopePolicyVersion(requiredScopes)
  if (!requiredScopes.every((scope) => managed.scopes.includes(scope))) {
    throw new CredentialGroupProviderConfigurationError(
      'Managed-user permissions changed. Reconfigure Slack on this Credential Group.'
    )
  }
  return {
    provider: PROVIDER,
    providerId: service.providerId,
    authorizationAppId: `slack:${managed.appId}:${managed.teamId}`,
    requiredScopes,
    scopeVersion,
    slackBotCredentialId: managed.slackBotCredentialId,
    clientId: managed.clientId,
    clientSecret: managed.clientSecret,
    appId: managed.appId,
    teamId: managed.teamId,
  }
}

/**
 * Slack tools still request the legacy canonical bot bundle when they do not declare
 * operation-level scopes. Managed user grants translate only that exact fallback to the
 * managed-user policy; explicit tool scopes remain exact requirements.
 */
function hasRequiredSlackScopes(grantedScopes: string[], requiredScopes: string[]): boolean {
  const granted = new Set(grantedScopes)
  const canonicalBotScopes = getCredentialGroupProviderService(PROVIDER).scopes
  const isCanonicalFallback =
    requiredScopes.length === canonicalBotScopes.length &&
    requiredScopes.every((scope) => canonicalBotScopes.includes(scope))
  const effectiveRequiredScopes = isCanonicalFallback ? SLACK_MANAGED_USER_SCOPES : requiredScopes
  return effectiveRequiredScopes.every((scope) => granted.has(scope))
}

export const slackCredentialGroupProviderAdapter: CredentialGroupProviderAdapter = {
  provider: PROVIDER,
  requiresRefreshToken: false,
  async getPolicy(option, context) {
    if (!context.credentialGroupId) {
      throw new CredentialGroupProviderConfigurationError('Credential Group context is required')
    }
    const slackBotCredentialId = option?.slackBotCredentialId
    return getSlackPolicy({
      workspaceId: context.workspaceId,
      credentialGroupId: context.credentialGroupId,
      ...(slackBotCredentialId ? { slackBotCredentialId } : {}),
      ...(context.executor ? { executor: context.executor } : {}),
    })
  },
  async prepareAuthorization(context, policy) {
    const currentPolicy = await getSlackPolicy({
      workspaceId: context.workspaceId,
      credentialGroupId: context.credentialGroupId,
      slackBotCredentialId: context.option.slackBotCredentialId,
    })
    if (currentPolicy.authorizationAppId !== policy.authorizationAppId) {
      throw new CredentialGroupOAuthError(
        'This credential option changed. Reload the invitation and try again.',
        409
      )
    }
    const redirectUri = `${getBaseUrl()}${SLACK_MANAGED_USER_ENROLLMENT_CALLBACK_PATH}`
    return {
      redirectUri,
      buildAuthorizationUrl: ({ state }) => {
        const authorizationUrl = new URL('https://slack.com/oauth/v2/authorize')
        authorizationUrl.searchParams.set('client_id', currentPolicy.clientId)
        authorizationUrl.searchParams.set('user_scope', policy.requiredScopes.join(','))
        authorizationUrl.searchParams.set('redirect_uri', redirectUri)
        authorizationUrl.searchParams.set('state', state)
        authorizationUrl.searchParams.set('team', currentPolicy.teamId)
        return authorizationUrl.toString()
      },
    }
  },
  async exchangeAndVerify({ context, attempt, code, policy }) {
    const currentPolicy = await getSlackPolicy({
      workspaceId: context.workspaceId,
      credentialGroupId: context.credentialGroupId,
      slackBotCredentialId: context.option.slackBotCredentialId,
    })
    const redirectUri = `${getBaseUrl()}${SLACK_MANAGED_USER_ENROLLMENT_CALLBACK_PATH}`
    if (
      currentPolicy.authorizationAppId !== policy.authorizationAppId ||
      attempt.redirectUri !== redirectUri
    ) {
      throw new CredentialGroupOAuthError('Authorization state is invalid or expired.', 400)
    }

    let grant: Awaited<ReturnType<typeof exchangeSlackUserAuthorization>>
    try {
      grant = await exchangeSlackUserAuthorization({
        clientId: currentPolicy.clientId,
        clientSecret: currentPolicy.clientSecret,
        code,
        redirectUri: attempt.redirectUri,
      })
    } catch {
      throw new CredentialGroupOAuthError(
        'Slack could not complete authorization. Please try again.',
        502
      )
    }

    if (grant.expiresIn !== undefined || grant.refreshToken) {
      await Promise.allSettled(
        [grant.accessToken, grant.refreshToken]
          .filter((token): token is string => Boolean(token))
          .map(revokeSlackToken)
      )
      throw new CredentialGroupOAuthError(
        'Slack token rotation was enabled after this app was configured. Disable it and try again.',
        409
      )
    }

    try {
      if (
        grant.appId !== currentPolicy.appId ||
        grant.teamId !== currentPolicy.teamId ||
        !hasRequiredSlackScopes(grant.scopes, policy.requiredScopes)
      ) {
        throw new CredentialGroupOAuthError(
          'All requested Slack permissions are required to connect this account.',
          403
        )
      }
      const identity = await verifySlackUserIdentity({
        accessToken: grant.accessToken,
        expectedTeamId: grant.teamId,
        expectedUserId: grant.userId,
      })
      const email = normalizeEmail(identity.email)
      if (email !== context.email) {
        throw new CredentialGroupOAuthError(
          `Sign in with ${context.email} to complete this invitation.`,
          403
        )
      }

      return {
        providerId: policy.providerId,
        providerSubjectId: identity.userId,
        providerTenantId: identity.teamId,
        displayName: email,
        metadata: {
          email,
          ...(identity.displayName ? { displayName: identity.displayName } : {}),
          ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
          ...(identity.username ? { username: identity.username } : {}),
        },
        accessToken: grant.accessToken,
        grantedScopes: [...new Set(grant.scopes)],
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      }
    } catch (error) {
      await revokeSlackToken(grant.accessToken)
      if (error instanceof CredentialGroupOAuthError) throw error
      throw new CredentialGroupOAuthError('Slack could not verify the granted access.', 502)
    }
  },
  hasRequiredScopes: hasRequiredSlackScopes,
  async refreshToken() {
    throw new Error('Slack managed credentials do not use token refresh')
  },
  isTerminalRefreshError() {
    return false
  },
}
