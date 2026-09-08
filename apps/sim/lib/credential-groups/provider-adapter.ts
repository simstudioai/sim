import { createHash } from 'node:crypto'
import type { CredentialGroupOptionConfig, ManagedOAuthProviderMetadata } from '@sim/db/schema'
import type { CredentialGroupOAuthContext } from '@/lib/credential-groups/enrollments'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import type { DbOrTx } from '@/lib/db/types'
import type { RefreshTokenResult } from '@/lib/oauth'

export interface CredentialGroupProviderPolicy {
  provider: CredentialGroupProvider
  providerId: string
  authorizationAppId: string
  requiredScopes: string[]
  scopeVersion: number
}

export function credentialGroupScopePolicyVersion(scopes: string[]): number {
  const digest = createHash('sha256')
    .update([...new Set(scopes)].sort().join('\0'))
    .digest()
  const version = digest.readUInt32BE(0) & 0x7fffffff
  return version || 1
}

export interface VerifiedCredentialGroupGrant {
  providerId: string
  providerSubjectId: string
  providerTenantId: string | null
  displayName: string
  metadata: ManagedOAuthProviderMetadata
  accessToken: string
  refreshToken?: string
  grantedScopes: string[]
  accessTokenExpiresAt: Date | null
  refreshTokenExpiresAt: Date | null
}

export interface PreparedCredentialGroupAuthorization {
  redirectUri: string
  codeVerifier?: string
  buildAuthorizationUrl(params: { state: string; nonce: string }): string | Promise<string>
}

export interface CredentialGroupProviderAdapter {
  provider: CredentialGroupProvider
  requiresRefreshToken: boolean
  getPolicy(
    option:
      | (Pick<CredentialGroupOptionConfig, 'provider' | 'slackBotCredentialId'> &
          Partial<Pick<CredentialGroupOptionConfig, 'requiredScopes'>>)
      | undefined,
    context: {
      workspaceId?: string | null
      organizationId?: string | null
      credentialGroupId?: string
      credentialGroupOptionId?: string
      authorizationAppId?: string
      executor?: DbOrTx
    }
  ): Promise<CredentialGroupProviderPolicy>
  prepareAuthorization(
    context: CredentialGroupOAuthContext,
    policy: CredentialGroupProviderPolicy
  ): Promise<PreparedCredentialGroupAuthorization>
  exchangeAndVerify(params: {
    context: CredentialGroupOAuthContext
    attempt: CredentialGroupOAuthAttempt
    code: string
    policy: CredentialGroupProviderPolicy
  }): Promise<VerifiedCredentialGroupGrant>
  hasRequiredScopes(grantedScopes: string[], requiredScopes: string[]): boolean
  refreshToken(refreshToken: string): Promise<RefreshTokenResult>
  isTerminalRefreshError(errorCode: string | undefined): boolean
}

export class CredentialGroupProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialGroupProviderConfigurationError'
  }
}

export class CredentialGroupOAuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 401 | 403 | 404 | 409 | 502 | 503
  ) {
    super(message)
    this.name = 'CredentialGroupOAuthError'
  }
}

export class CredentialGroupInvitationUnavailableError extends CredentialGroupOAuthError {
  constructor() {
    super('This account invitation was revoked.', 409)
    this.name = 'CredentialGroupInvitationUnavailableError'
  }
}
