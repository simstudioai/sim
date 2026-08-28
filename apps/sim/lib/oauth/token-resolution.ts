import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import {
  impersonateEmailSchema,
  type OAuthTokenResponse,
} from '@/lib/api/contracts/oauth-connections'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import type { AuthResult } from '@/lib/auth/hybrid'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import {
  getCredential,
  type LoadedOAuthCredential,
  type ResolvedCredential,
  refreshTokenIfNeeded,
  resolveOAuthAccountId,
  resolveServiceAccountToken,
} from '@/lib/oauth/credential-service'
import { extractSalesforceInstanceUrl, isSalesforceOAuthProviderId } from '@/lib/oauth/salesforce'
import { captureServerEvent } from '@/lib/posthog/server'
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
  /** Reuses a credential lookup already performed by the route's managed-OAuth dispatch. */
  resolvedCredential?: ResolvedCredential | null
}

export type ResolveCredentialTokenResult =
  | { ok: true; token: CredentialTokenPayload }
  | { ok: false; status: number; error: string; code?: string }

/**
 * Emits the semantic "credential used" trail for one resolved credential.
 * Both the audit row and the analytics event are fire-and-forget.
 */
function recordCredentialAccess(params: {
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
  credential: { providerId: string; scope?: string | null; idToken?: string | null },
  accessToken: string
): CredentialTokenPayload {
  const instanceUrl = isSalesforceOAuthProviderId(credential.providerId)
    ? extractSalesforceInstanceUrl(credential.scope ?? undefined)
    : undefined

  let apiDomain: string | undefined
  if (credential.providerId === 'zoho-desk' && credential.scope) {
    apiDomain = extractZohoDeskBaseFromScope(credential.scope)
  }

  return {
    accessToken,
    idToken: credential.idToken || undefined,
    ...(instanceUrl && { instanceUrl }),
    ...(apiDomain && { apiDomain }),
  }
}

/**
 * Refreshes an authorized OAuth credential, records its access trail, and
 * projects the token payload. Shared by every surface that has already
 * authorized the credential and loaded it.
 */
export async function completeOAuthCredentialToken(params: {
  requestId: string
  /**
   * The decrypted row from `getCredential`. Previously declared as a narrow
   * `{ providerId, scope?, idToken? }`, which only type-checked because
   * `refreshTokenIfNeeded` took `any` — every caller has always passed the full row.
   */
  credential: LoadedOAuthCredential & { scope?: string | null }
  resolvedCredentialId: string
  actorId?: string
  workspaceId: string | null
  auditRequest?: CredentialAuditRequest
}): Promise<ResolveCredentialTokenResult> {
  const { requestId, credential, resolvedCredentialId, actorId, workspaceId, auditRequest } = params
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
 * Authorized application operation behind `POST /api/auth/oauth/token`. Every surface that
 * needs a credential token — the route and the in-process tool executor — goes through
 * here, so authorization, refresh, and audit cannot drift between them.
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

    /**
     * Both branches below authorize with the same arguments, and neither read depends
     * on the other, so they resolve together — this runs per credentialed tool call.
     */
    const [resolved, authz] = await Promise.all([
      input.resolvedCredential === undefined
        ? resolveOAuthAccountId(credentialId)
        : input.resolvedCredential,
      authorizeCredentialUseForAuth(auth, { credentialId, workflowId, callerUserId }),
    ])

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
