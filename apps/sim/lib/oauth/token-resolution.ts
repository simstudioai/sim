import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type DelegatedPrincipal, resolvePrincipalSubject } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  impersonateEmailSchema,
  type OAuthTokenResponse,
} from '@/lib/api/contracts/oauth-connections'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import type { AuthResult } from '@/lib/auth/hybrid'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { InvalidManagedOAuthDelegationError } from '@/lib/credentials/application/managed-oauth-delegation'
import { resolveManagedOAuthCredentialToken } from '@/lib/credentials/application/resolve-managed-oauth-token'
import { ManagedOAuthCredentialError } from '@/lib/credentials/managed-oauth'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import {
  getCredential,
  type ResolvedCredential,
  refreshTokenIfNeeded,
  resolveOAuthAccountId,
  resolveServiceAccountToken,
} from '@/lib/oauth/credential-service'
import {
  extractMicrosoftDataverseEnvironmentUrl,
  MICROSOFT_DATAVERSE_PROVIDER_ID,
} from '@/lib/oauth/microsoft-dataverse'
import { parseQuickBooksAccountId } from '@/lib/oauth/quickbooks'
import { extractSalesforceInstanceUrl, isSalesforceOAuthProviderId } from '@/lib/oauth/salesforce'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'
import { captureServerEvent } from '@/lib/posthog/server'
import { getToolMetadata } from '@/tools/metadata'
import { extractZohoDeskBaseFromScope } from '@/tools/zoho_desk/host-allowlist'

const logger = createLogger('OAuthTokenResolution')

/**
 * Duck type of the inbound request, used only so audit rows record IP and user agent.
 * In-process callers omit it.
 */
export interface CredentialAuditRequest {
  headers: { get(name: string): string | null }
}

/** Token material a resolved credential yields; taken from the contract so it cannot drift. */
export type CredentialTokenPayload = OAuthTokenResponse

export interface ResolveCredentialTokenInput {
  /** Correlation id used by the credential service's own logging. */
  requestId: string
  credentialId?: string
  workflowId?: string
  /** Canonical provider scopes, used only by service-account token minting. */
  scopes?: string[]
  /** Google domain-wide-delegation subject for service-account credentials. */
  impersonateEmail?: string
  /**
   * Asserted acting user. When the caller authenticated with an internal JWT it
   * must equal the token subject, so a forged assertion cannot widen access.
   */
  callerUserId?: string
  auditRequest?: CredentialAuditRequest
  /** Credential lookup already performed by {@link resolveCredentialAccessToken}'s dispatch. */
  resolvedCredential: ResolvedCredential | null
}

export type ResolveCredentialTokenResult =
  | { ok: true; token: CredentialTokenPayload }
  | { ok: false; status: number; error: string; code?: string }

interface OAuthCredentialContext {
  providerId: string
  accountId?: string | null
}

export function validateOAuthCredentialContext(
  credential: OAuthCredentialContext
): { ok: true } | { ok: false; error: string } {
  if (credential.providerId !== 'quickbooks') return { ok: true }

  try {
    parseQuickBooksAccountId(credential.accountId ?? '')
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(
        error,
        'QuickBooks company identity is invalid. Reconnect the QuickBooks credential.'
      ),
    }
  }
}

/**
 * Emits the semantic "credential used" trail for one resolved credential.
 * Both the audit row and the analytics event are fire-and-forget.
 */
export function recordCredentialAccess(params: {
  actorId: string
  workspaceId: string | null
  resourceId: string
  providerId: string | null | undefined
  credentialType: 'oauth' | 'service_account'
  auditRequest?: CredentialAuditRequest
}): void {
  const { actorId, workspaceId, resourceId, providerId, credentialType } = params
  recordAudit({
    workspaceId,
    actorId,
    action: AuditAction.CREDENTIAL_ACCESSED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId,
    description: `Accessed ${credentialType === 'oauth' ? 'OAuth' : 'service account'} credential for provider ${providerId ?? 'unknown'}`,
    metadata: {
      provider: providerId,
      credentialType,
    },
    request: params.auditRequest,
  })
  captureServerEvent(
    actorId,
    'credential_used',
    {
      credential_type: credentialType,
      provider_id: providerId ?? 'unknown',
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
    },
    workspaceId ? { groups: { workspace: workspaceId } } : undefined
  )
}

/**
 * Projects a stored OAuth credential plus its access token into the wire payload.
 * Provider hosts come out of the scope string through shared allowlisted helpers, never a
 * local regex — these values are injected into tool calls that carry the token.
 */
function buildOAuthTokenPayload(
  credential: {
    providerId: string
    accountId?: string | null
    scope?: string | null
    idToken?: string | null
  },
  accessToken: string
): CredentialTokenPayload {
  const instanceUrl = isSalesforceOAuthProviderId(credential.providerId)
    ? extractSalesforceInstanceUrl(credential.scope ?? undefined)
    : credential.providerId === MICROSOFT_DATAVERSE_PROVIDER_ID
      ? extractMicrosoftDataverseEnvironmentUrl(credential.scope)
      : undefined

  let apiDomain: string | undefined
  if (credential.providerId === 'zoho-desk' && credential.scope) {
    apiDomain = extractZohoDeskBaseFromScope(credential.scope)
  }

  const quickBooksIdentity =
    credential.providerId === 'quickbooks'
      ? parseQuickBooksAccountId(credential.accountId ?? '')
      : undefined

  return {
    accessToken,
    credentialType: 'oauth',
    idToken: credential.idToken || undefined,
    ...(instanceUrl && { instanceUrl }),
    ...(apiDomain && { apiDomain }),
    ...(quickBooksIdentity && {
      realmId: quickBooksIdentity.realmId,
      quickBooksEnvironment: quickBooksIdentity.environment,
    }),
  }
}

/**
 * Refreshes an authorized OAuth credential, records its access trail, and
 * projects the token payload. Shared by every surface that has already
 * authorized the credential and loaded it.
 */
export async function completeOAuthCredentialToken(params: {
  requestId: string
  credential: {
    providerId: string
    accountId?: string | null
    scope?: string | null
    idToken?: string | null
  }
  resolvedCredentialId: string
  actorId?: string
  workspaceId: string | null
  auditRequest?: CredentialAuditRequest
}): Promise<ResolveCredentialTokenResult> {
  const { requestId, credential, resolvedCredentialId, actorId, workspaceId, auditRequest } = params
  const contextValidation = validateOAuthCredentialContext(credential)
  if (!contextValidation.ok) {
    return { ok: false, status: 401, error: contextValidation.error }
  }

  try {
    const { accessToken } = await refreshTokenIfNeeded(requestId, credential, resolvedCredentialId)

    if (actorId) {
      recordCredentialAccess({
        actorId,
        workspaceId,
        resourceId: resolvedCredentialId,
        providerId: credential.providerId,
        credentialType: 'oauth',
        auditRequest,
      })
    }

    return { ok: true, token: buildOAuthTokenPayload(credential, accessToken) }
  } catch (error) {
    logger.error(`[${requestId}] Failed to refresh access token:`, error)
    return { ok: false, status: 401, error: 'Failed to refresh access token' }
  }
}

/**
 * Resolves a plain OAuth or service-account credential to a token for an
 * authenticated caller. Managed OAuth credentials are dispatched one level up by
 * {@link resolveCredentialAccessToken}, which every server surface goes through,
 * so authorization, refresh, and audit cannot drift between surfaces.
 *
 * @param auth Result of authenticating the caller (session or internal JWT).
 */
export async function resolveCredentialToken(
  auth: AuthResult,
  input: ResolveCredentialTokenInput
): Promise<ResolveCredentialTokenResult> {
  const {
    requestId,
    credentialId,
    workflowId,
    scopes,
    impersonateEmail,
    callerUserId,
    auditRequest,
  } = input

  try {
    if (!credentialId) {
      return { ok: false, status: 400, error: 'Credential ID is required' }
    }
    if (
      impersonateEmail !== undefined &&
      !impersonateEmailSchema.safeParse(impersonateEmail).success
    ) {
      return { ok: false, status: 400, error: 'impersonateEmail must be a valid email address' }
    }

    const resolved = input.resolvedCredential
    const authz = await authorizeCredentialUseForAuth(auth, {
      credentialId,
      workflowId,
      callerUserId,
    })

    if (resolved?.credentialType === 'service_account' && resolved.credentialId) {
      if (!authz.ok) {
        return { ok: false, status: 403, error: authz.error || 'Unauthorized' }
      }

      const saActorId = authz.requesterUserId
      const saWorkspaceId = resolved.workspaceId ?? authz.workspaceId ?? null

      try {
        const result = await resolveServiceAccountToken(
          resolved.credentialId,
          resolved.providerId,
          scopes ?? [],
          impersonateEmail
        )

        if (saActorId) {
          recordCredentialAccess({
            actorId: saActorId,
            workspaceId: saWorkspaceId,
            resourceId: resolved.credentialId,
            providerId: resolved.providerId,
            credentialType: 'service_account',
            auditRequest,
          })
        }

        return {
          ok: true,
          token: {
            accessToken: result.accessToken,
            credentialType: 'service_account',
            cloudId: result.cloudId,
            domain: result.domain,
            instanceUrl: result.instanceUrl,
            apiDomain: result.apiDomain,
            authStyle: result.authStyle,
          },
        }
      } catch (error) {
        logger.error(`[${requestId}] Service account token error:`, error)
        if (error instanceof TokenServiceAccountValidationError) {
          // Classified provider outages are infra failures, not bad credentials.
          if (error.code === 'provider_unavailable') {
            return {
              ok: false,
              status: 502,
              error: 'Credential provider is temporarily unavailable',
            }
          }
          // A stored host that no longer resolves is a configuration failure —
          // surface the code so runtime consumers can say "check the host"
          // instead of a generic auth error.
          if (error.code === 'site_not_found') {
            return {
              ok: false,
              status: 400,
              code: error.code,
              error: 'Credential host not found — reconnect the credential with a valid host',
            }
          }
          // A revoked/rotated-away or misconfigured stored secret — surface the
          // code so runtime consumers can prompt to reconnect the credential
          // rather than showing a generic auth failure.
          if (error.code === 'invalid_credentials') {
            return {
              ok: false,
              status: 401,
              code: error.code,
              error: 'Credential rejected by the provider — reconnect the credential',
            }
          }
        }
        return { ok: false, status: 401, error: 'Failed to get service account token' }
      }
    }

    if (!authz.ok || !authz.credentialOwnerUserId) {
      return { ok: false, status: 403, error: authz.error || 'Unauthorized' }
    }

    const resolvedCredentialId = authz.resolvedCredentialId || credentialId
    const credential = await getCredential(
      requestId,
      resolvedCredentialId,
      authz.credentialOwnerUserId
    )

    if (!credential) {
      return { ok: false, status: 404, error: 'Credential not found' }
    }

    return completeOAuthCredentialToken({
      requestId,
      credential,
      resolvedCredentialId,
      actorId: authz.requesterUserId,
      workspaceId: authz.workspaceId ?? null,
      auditRequest,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting access token`, error)
    return { ok: false, status: 500, error: 'Internal server error' }
  }
}

export interface ResolveCredentialAccessTokenInput
  extends Omit<ResolveCredentialTokenInput, 'resolvedCredential'> {
  /** Tool consuming the token; required by the managed-OAuth scope policy. */
  toolId?: string
  /**
   * Authenticates the caller for non-managed credentials. Invoked only when the
   * credential is not managed OAuth, which authenticates through delegation instead.
   */
  authenticate: () => AuthResult | Promise<AuthResult>
  /**
   * Proves a delegation for one managed credential: a workflow execution (the
   * route verifies the delegation JWT header; the executor binds its delegation
   * origin in-process) or a Chat turn acting as the signed-in user. Absent,
   * managed credentials are rejected with `MANAGED_CREDENTIAL_DELEGATION_REQUIRED`.
   * Must throw {@link InvalidManagedOAuthDelegationError} on an invalid delegation.
   */
  resolveManagedPrincipal?: (credentialId: string) => Promise<DelegatedPrincipal>
}

/**
 * Authorized application dispatch behind `POST /api/auth/oauth/token`. Every server
 * surface that needs a credential token — the route and the in-process tool
 * executor — goes through here, so the managed / service-account / plain-OAuth
 * dispatch, authorization, refresh, audit, and analytics cannot drift between them.
 */
export async function resolveCredentialAccessToken(
  input: ResolveCredentialAccessTokenInput
): Promise<ResolveCredentialTokenResult> {
  const { requestId, credentialId, toolId, auditRequest } = input

  const resolved = credentialId ? await resolveOAuthAccountId(credentialId) : null

  if (resolved?.credentialType !== 'managed_oauth' || !resolved.credentialId) {
    const auth = await input.authenticate()
    return resolveCredentialToken(auth, {
      requestId,
      credentialId,
      workflowId: input.workflowId,
      scopes: input.scopes,
      /**
       * In-process callers forward raw subblock state, where an untouched
       * field is '' — treated as absent, matching what the wire contract
       * (which rejects '') and the old truthy guards always produced.
       */
      impersonateEmail: input.impersonateEmail || undefined,
      callerUserId: input.callerUserId,
      auditRequest,
      resolvedCredential: resolved,
    })
  }

  if (!input.resolveManagedPrincipal) {
    return {
      ok: false,
      status: 403,
      code: 'MANAGED_CREDENTIAL_DELEGATION_REQUIRED',
      error: 'Managed credentials can only be used by an authenticated workflow execution',
    }
  }

  let principal: DelegatedPrincipal
  try {
    principal = await input.resolveManagedPrincipal(resolved.credentialId)
  } catch (error) {
    if (!(error instanceof InvalidManagedOAuthDelegationError)) throw error
    return {
      ok: false,
      status: 401,
      code: 'MANAGED_CREDENTIAL_DELEGATION_INVALID',
      error: error.message,
    }
  }

  if (!toolId) {
    return {
      ok: false,
      status: 400,
      code: 'MANAGED_CREDENTIAL_TOOL_REQUIRED',
      error: 'A tool ID is required to use a managed credential',
    }
  }

  const toolMetadata = getToolMetadata(toolId)
  if (!toolMetadata?.oauth?.required) {
    logger.error(`[${requestId}] Tool is not configured for managed OAuth`, { toolId })
    return {
      ok: false,
      status: 500,
      code: 'MANAGED_CREDENTIAL_TOOL_UNSUPPORTED',
      error: 'This tool is not configured to use managed credentials',
    }
  }
  const requiredScopes =
    toolMetadata.oauth.requiredScopes ?? getCanonicalScopesForProvider(toolMetadata.oauth.provider)
  if (requiredScopes.length === 0 && toolMetadata.oauth.requiredScopes === undefined) {
    logger.error(`[${requestId}] Tool has no trusted OAuth scope policy`, {
      toolId,
      providerId: toolMetadata.oauth.provider,
    })
    return {
      ok: false,
      status: 500,
      code: 'MANAGED_CREDENTIAL_TOOL_UNSUPPORTED',
      error: 'This tool is not configured to use managed credentials',
    }
  }

  try {
    const result = await resolveManagedOAuthCredentialToken.execute({
      principal,
      input: {
        credentialId: resolved.credentialId,
        expectedProviderId: toolMetadata.oauth.provider,
        requiredScopes,
        toolId,
      },
      request: auditRequest,
    })

    const subject = resolvePrincipalSubject(principal)
    if (subject?.kind === 'sim_user') {
      captureServerEvent(
        subject.userId,
        'credential_used',
        {
          credential_type: 'managed_oauth',
          provider_id: toolMetadata.oauth.provider,
          workspace_id: principal.workspaceId,
        },
        { groups: { workspace: principal.workspaceId } }
      )
    }

    return {
      ok: true,
      token: {
        accessToken: result.accessToken,
        credentialType: 'managed_oauth',
        idToken: result.idToken,
      },
    }
  } catch (error) {
    if (error instanceof ManagedOAuthCredentialError) {
      logger.warn(`[${requestId}] Managed OAuth credential rejected`, {
        credentialId: resolved.credentialId,
        code: error.code,
      })
      return { ok: false, status: error.statusCode, code: error.code, error: error.message }
    }

    const orchestrationError = asOrchestrationError(error)
    if (orchestrationError) {
      return {
        ok: false,
        status: statusForOrchestrationError(orchestrationError.code),
        code: 'MANAGED_CREDENTIAL_UNAUTHORIZED',
        error: orchestrationError.message,
      }
    }
    throw error
  }
}
