import { AuditAction, AuditResourceType, recordAudit, recordAuditRollup } from '@sim/audit'
import { type DelegatedPrincipal, resolvePrincipalSubject } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { impersonateEmailSchema } from '@/lib/api/contracts/oauth-connections'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { InvalidManagedOAuthDelegationError } from '@/lib/credentials/application/managed-oauth-delegation'
import { resolveManagedOAuthCredentialToken } from '@/lib/credentials/application/resolve-managed-oauth-token'
import { ManagedOAuthCredentialError } from '@/lib/credentials/managed-oauth'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { projectAssistantConnectedAccountTool } from '@/lib/mothership/assistant/connected-account-tool'
import { CredentialRevokedError, OAUTH_CREDENTIAL_REVOKED } from '@/lib/oauth/credential-revoked'
import {
  getCredential,
  type ResolvedCredential,
  refreshTokenIfNeeded,
  resolveOAuthAccountId,
  resolveServiceAccountToken,
  type ServiceAccountTokenResult,
} from '@/lib/oauth/credential-service'
import {
  extractMicrosoftDataverseEnvironmentUrl,
  MICROSOFT_DATAVERSE_PROVIDER_ID,
} from '@/lib/oauth/microsoft-dataverse'
import { parseQuickBooksAccountId } from '@/lib/oauth/quickbooks'
import { extractSalesforceInstanceUrl, isSalesforceOAuthProviderId } from '@/lib/oauth/salesforce'
import {
  credentialProviderMatchesService,
  getDefaultToolScopesForProvider,
  getServiceConfigByProviderId,
  getServiceConfigByServiceId,
} from '@/lib/oauth/utils'
import { captureServerEvent } from '@/lib/posthog/server'
import { getToolMetadata } from '@/tools/metadata'
import type { QuickBooksEnvironment } from '@/tools/quickbooks/client'
import type { OAuthConfig } from '@/tools/types'
import { extractZohoDeskBaseFromScope } from '@/tools/zoho_desk/host-allowlist'

const logger = createLogger('OAuthTokenResolution')

/**
 * A failure Sim's side can't currently get past (the organization's egress gateway is down or
 * refuses the route), or null. Never a sign the credential is bad, so the caller is told to
 * retry rather than reconnect.
 */
function unavailableFailure(
  error: unknown
): Extract<ResolveCredentialTokenResult, { ok: false }> | null {
  const classified = asOrchestrationError(error)
  if (classified?.code !== 'unavailable') return null
  return {
    ok: false,
    status: statusForOrchestrationError('unavailable'),
    error: classified.message,
  }
}

/**
 * Duck type of the inbound request, used only so audit rows record IP and user agent.
 * In-process callers omit it.
 */
export interface CredentialAuditRequest {
  headers: { get(name: string): string | null }
}

/**
 * Token material a resolved credential yields to the tool that consumes it: everything a
 * service-account mint returns, plus the OAuth-only identity fields.
 */
export interface CredentialTokenPayload extends ServiceAccountTokenResult {
  credentialType?: 'oauth' | 'managed_oauth' | 'service_account'
  idToken?: string
  realmId?: string
  quickBooksEnvironment?: QuickBooksEnvironment
}

interface ResolveCredentialTokenInput {
  /** Tool whose canonical provider and credential-kind policy applies before token minting. */
  toolId?: string
  /**
   * The call is an Assistant turn acting with the person's own connected account, so the
   * tool's policy is the one the Assistant projects for it (GitHub tools bind the person's
   * GitHub account, never a workspace token). Set only by the in-process executor for an
   * authenticated Assistant turn.
   */
  assistantConnectedAccount?: boolean
  /** Correlation id used by the credential service's own logging. */
  requestId: string
  credentialId?: string
  workflowId?: string
  /** Workflow run the token is for; recorded on the credential-access audit entry. */
  executionId?: string
  /** Canonical provider scopes, used only by service-account token minting. */
  scopes?: string[]
  /** Google domain-wide-delegation subject for service-account credentials. */
  impersonateEmail?: string
  /** Acting user whose credential access is enforced; absent when access is not enforced. */
  callerUserId?: string
  /**
   * User the server-side execution runs as, authorizing non-managed credentials.
   * Managed OAuth credentials authenticate through delegation instead.
   */
  userId?: string
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

function validateOAuthCredentialContext(
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
 * Both the audit row and the analytics event are fire-and-forget. A server-side
 * access with no client request, such as a workflow run refreshing the token
 * for every tool call, merges with its repeats into one row that counts them.
 */
export function recordCredentialAccess(params: {
  actorId: string
  workspaceId: string | null
  resourceId: string
  providerId: string | null | undefined
  credentialType: 'oauth' | 'service_account'
  workflowId?: string
  executionId?: string
  auditRequest?: CredentialAuditRequest
}): void {
  const { actorId, workspaceId, resourceId, providerId, credentialType, workflowId, executionId } =
    params
  const credentialLabel = `${credentialType === 'oauth' ? 'OAuth' : 'service account'} credential for provider ${providerId ?? 'unknown'}`
  const audit = {
    workspaceId,
    actorId,
    action: AuditAction.CREDENTIAL_ACCESSED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId,
    description: `Accessed ${credentialLabel}`,
    metadata: {
      provider: providerId,
      credentialType,
      ...(workflowId ? { workflowId } : {}),
      ...(executionId ? { executionId } : {}),
    },
  }
  if (params.auditRequest) {
    recordAudit({ ...audit, request: params.auditRequest })
  } else {
    recordAuditRollup({
      key: JSON.stringify(audit.metadata),
      params: audit,
      rollupMetadata: audit.metadata,
      counters: {},
      identifiers: {},
      describe: ({ entries }) => `Accessed ${credentialLabel} ${entries} times`,
    })
  }
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
  workflowId?: string
  executionId?: string
}): Promise<ResolveCredentialTokenResult> {
  const {
    requestId,
    credential,
    resolvedCredentialId,
    actorId,
    workspaceId,
    workflowId,
    executionId,
  } = params
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
        workflowId,
        executionId,
      })
    }

    return { ok: true, token: buildOAuthTokenPayload(credential, accessToken) }
  } catch (error) {
    if (error instanceof CredentialRevokedError) {
      logger.warn('OAuth credential revoked by provider; reconnect required', {
        requestId,
        credentialId: resolvedCredentialId,
        providerId: error.provider?.providerId,
        errorCode: error.provider?.errorCode,
      })
      return { ok: false, status: 401, code: OAUTH_CREDENTIAL_REVOKED, error: error.message }
    }
    const unavailable = unavailableFailure(error)
    if (unavailable) {
      logger.warn('Egress route unavailable for token refresh', { requestId })
      return unavailable
    }
    logger.error('Failed to refresh access token:', error, { requestId })
    return { ok: false, status: 401, error: 'Failed to refresh access token' }
  }
}

function validateToolCredentialKind(
  requiredKind: OAuthConfig['credentialKind'],
  actualKind: NonNullable<OAuthConfig['credentialKind']>
): Extract<ResolveCredentialTokenResult, { ok: false }> | undefined {
  if (requiredKind && requiredKind !== actualKind) {
    return {
      ok: false,
      status: 400,
      code: 'CREDENTIAL_TYPE_MISMATCH',
      error: 'The selected credential type is not supported by this tool',
    }
  }
}

/** The credential policy a tool call binds through: the registry's, or the Assistant's projection of it. */
function toolCredentialPolicy(
  toolId: string,
  assistantConnectedAccount: boolean | undefined
): OAuthConfig | undefined {
  const tool = getToolMetadata(toolId)
  if (!tool) return undefined
  return (assistantConnectedAccount ? projectAssistantConnectedAccountTool(tool) : tool).oauth
}

function validateToolCredentialBinding(
  toolId: string | undefined,
  assistantConnectedAccount: boolean | undefined,
  providerId: string | null | undefined,
  credentialKind: NonNullable<OAuthConfig['credentialKind']>
): Extract<ResolveCredentialTokenResult, { ok: false }> | undefined {
  if (!toolId) return
  const policy = toolCredentialPolicy(toolId, assistantConnectedAccount)
  const kindError = validateToolCredentialKind(policy?.credentialKind, credentialKind)
  if (kindError) return kindError
  /**
   * A tool binds a credential through its declared provider. `required: false`
   * marks a hybrid tool (inline keys or a saved credential) — the credential is
   * optional, but when one is supplied it must still belong to that provider.
   */
  const service = policy
    ? (getServiceConfigByServiceId(policy.provider) ??
      getServiceConfigByProviderId(policy.provider))
    : undefined
  if (!providerId || !service || !credentialProviderMatchesService(providerId, service)) {
    return {
      ok: false,
      status: 400,
      code: 'CREDENTIAL_PROVIDER_MISMATCH',
      error: 'The selected credential does not belong to this tool provider',
    }
  }
}

/**
 * Resolves a plain OAuth or service-account credential to a token for server-side
 * execution. Managed OAuth credentials are dispatched one level up by
 * {@link resolveCredentialAccessToken}.
 */
async function resolveCredentialToken(
  input: ResolveCredentialTokenInput
): Promise<ResolveCredentialTokenResult> {
  const {
    requestId,
    credentialId,
    workflowId,
    executionId,
    scopes,
    impersonateEmail,
    callerUserId,
    userId,
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
    const authz = await authorizeCredentialUseForAuth(
      { success: true, userId, authType: AuthType.INTERNAL_JWT },
      {
        credentialId,
        workflowId,
        callerUserId,
      }
    )

    if (resolved?.credentialType === 'service_account' && resolved.credentialId) {
      if (!authz.ok) {
        return { ok: false, status: 403, error: authz.error || 'Unauthorized' }
      }

      // A saved secret is released only to a tool of its own provider, never on a bare ID.
      if (!input.toolId) {
        return {
          ok: false,
          status: 400,
          code: 'SERVICE_ACCOUNT_TOOL_REQUIRED',
          error: 'A tool ID is required to use a saved credential',
        }
      }
      const bindingError = validateToolCredentialBinding(
        input.toolId,
        input.assistantConnectedAccount,
        resolved.providerId,
        'service-account'
      )
      if (bindingError) return bindingError

      const saActorId = authz.requesterUserId
      const saWorkspaceId = resolved.workspaceId ?? authz.workspaceId ?? null

      try {
        const result = await resolveServiceAccountToken(
          resolved.credentialId,
          resolved.providerId,
          scopes ?? [],
          impersonateEmail,
          {
            service: toolCredentialPolicy(input.toolId, input.assistantConnectedAccount)?.provider,
          }
        )

        if (saActorId) {
          recordCredentialAccess({
            actorId: saActorId,
            workspaceId: saWorkspaceId,
            resourceId: resolved.credentialId,
            providerId: resolved.providerId,
            credentialType: 'service_account',
            workflowId,
            executionId,
          })
        }

        return {
          ok: true,
          token: {
            accessToken: result.accessToken,
            credentialType: 'service_account',
            cloudId: result.cloudId,
            domain: result.domain,
            providerWorkspaceId: result.providerWorkspaceId,
            applicationKey: result.applicationKey,
            instanceUrl: result.instanceUrl,
            apiDomain: result.apiDomain,
            authStyle: result.authStyle,
          },
        }
      } catch (error) {
        const unavailable = unavailableFailure(error)
        if (unavailable) {
          logger.warn('Egress route unavailable for service account token', { requestId })
          return unavailable
        }
        logger.error('Service account token error:', error, { requestId })
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
          // The stored host is one Sim's egress policy refuses (a private or
          // metadata address): a host problem, not a bad secret.
          if (error.code === 'host_not_allowed') {
            return {
              ok: false,
              status: 400,
              code: error.code,
              error: 'Credential host is not allowed — reconnect the credential with a public host',
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
          if (error.code === 'consent_required') {
            return {
              ok: false,
              status: 401,
              code: error.code,
              error:
                'The provider needs the impersonated user to grant consent — reconnect the credential to get the consent link',
            }
          }
          if (error.code === 'unsupported_use') {
            return {
              ok: false,
              status: 400,
              code: error.code,
              error: error.userMessage ?? 'This credential cannot be used here',
            }
          }
          if (error.code === 'cloud_mismatch') {
            return {
              ok: false,
              status: 400,
              code: error.code,
              error:
                'This credential signs in to a different Microsoft cloud than this service calls. Choose a credential registered in the cloud this service runs in',
            }
          }
          if (error.code === 'grant_not_permitted') {
            return {
              ok: false,
              status: 400,
              code: error.code,
              error:
                'The provider does not allow this app’s client credentials for the connected account — check the app’s installation and organization, then reconnect the credential',
            }
          }
          if (error.code === 'account_not_found') {
            return {
              ok: false,
              status: 400,
              code: error.code,
              error:
                'DocuSign found no account for this credential’s user. Check the Account ID on the credential, if one is set, and that the user belongs to an account in this environment, then reconnect the credential',
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

    const bindingError = validateToolCredentialBinding(
      input.toolId,
      input.assistantConnectedAccount,
      credential.providerId,
      'oauth'
    )
    if (bindingError) return bindingError

    return completeOAuthCredentialToken({
      requestId,
      credential,
      resolvedCredentialId,
      actorId: authz.requesterUserId,
      workspaceId: authz.workspaceId ?? null,
      workflowId,
      executionId,
    })
  } catch (error) {
    logger.error('Error getting access token', error, { requestId })
    return { ok: false, status: 500, error: 'Internal server error' }
  }
}

export interface ResolveCredentialAccessTokenInput
  extends Omit<ResolveCredentialTokenInput, 'resolvedCredential'> {
  /**
   * Proves a delegation for one managed credential: a workflow execution (the
   * executor binds its delegation origin in-process) or a Chat turn acting as the
   * signed-in user. Absent, managed credentials are rejected with
   * `MANAGED_CREDENTIAL_DELEGATION_REQUIRED`.
   * Must throw {@link InvalidManagedOAuthDelegationError} on an invalid delegation.
   */
  resolveManagedPrincipal?: (credentialId: string) => Promise<DelegatedPrincipal>
}

/**
 * Authorized application dispatch for a credential token during server-side
 * execution, so the managed / service-account / plain-OAuth dispatch,
 * authorization, refresh, audit, and analytics run in one place.
 */
export async function resolveCredentialAccessToken(
  input: ResolveCredentialAccessTokenInput
): Promise<ResolveCredentialTokenResult> {
  const { requestId, credentialId, toolId } = input

  const resolved = credentialId ? await resolveOAuthAccountId(credentialId) : null

  if (resolved?.credentialType !== 'managed_oauth' || !resolved.credentialId) {
    return resolveCredentialToken({
      requestId,
      credentialId,
      workflowId: input.workflowId,
      executionId: input.executionId,
      scopes: input.scopes,
      // The executor forwards raw subblock state, where an untouched field is '': treated as absent.
      impersonateEmail: input.impersonateEmail || undefined,
      callerUserId: input.callerUserId,
      userId: input.userId,
      resolvedCredential: resolved,
      toolId,
      assistantConnectedAccount: input.assistantConnectedAccount,
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

  const toolPolicy = toolCredentialPolicy(toolId, input.assistantConnectedAccount)
  if (!toolPolicy?.required) {
    logger.error('Tool is not configured for managed OAuth', { requestId, toolId })
    return {
      ok: false,
      status: 500,
      code: 'MANAGED_CREDENTIAL_TOOL_UNSUPPORTED',
      error: 'This tool is not configured to use managed credentials',
    }
  }
  const kindError = validateToolCredentialKind(toolPolicy.credentialKind, 'oauth')
  if (kindError) return kindError

  const requiredScopes =
    toolPolicy.requiredScopes ?? getDefaultToolScopesForProvider(toolPolicy.provider)
  if (requiredScopes.length === 0 && toolPolicy.requiredScopes === undefined) {
    logger.error('Tool has no trusted OAuth scope policy', {
      requestId,
      toolId,
      providerId: toolPolicy.provider,
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
        expectedProviderId: toolPolicy.provider,
        requiredScopes,
        toolId,
      },
    })

    const subject = resolvePrincipalSubject(principal)
    if (subject?.kind === 'sim_user') {
      captureServerEvent(
        subject.userId,
        'credential_used',
        {
          credential_type: 'managed_oauth',
          provider_id: toolPolicy.provider,
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
        ...(result.instanceUrl ? { instanceUrl: result.instanceUrl } : {}),
      },
    }
  } catch (error) {
    if (error instanceof ManagedOAuthCredentialError) {
      logger.warn('Managed OAuth credential rejected', {
        requestId,
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
        // An outage says nothing about the credential, so it carries no credential code.
        ...(orchestrationError.code === 'unavailable'
          ? {}
          : { code: 'MANAGED_CREDENTIAL_UNAUTHORIZED' }),
        error: orchestrationError.message,
      }
    }
    throw error
  }
}
