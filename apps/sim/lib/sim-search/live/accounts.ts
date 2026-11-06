import { db } from '@sim/db'
import { account, credential, user } from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { liveSearchProviderSchema } from '@/lib/api/contracts/mothership-assistant-tools'
import { fingerprint } from '@/lib/api/cursor-binding'
import {
  type ResourceOwner,
  type ResourceScope,
  resourceScopeFields,
  resourceScopeFromOwner,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { ORGANIZATION_VIEWER_ACCOUNT_LIMIT } from '@/lib/credential-groups/limits'
import { filterWorkspaceAccountCredentials } from '@/lib/credentials/application/workspace-account-visibility'
import { resolveManagedOAuthToken } from '@/lib/credentials/managed-oauth'
import { getOwnOrganizationManagedOAuthCredentials } from '@/lib/credentials/organization-managed'
import { getPersonalOAuthCredentials } from '@/lib/credentials/personal'
import { flowHeaders, normalizeFlowOrigin } from '@/lib/flow/client'
import { resolveKnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { resolveCredentialTokenBundle } from '@/lib/oauth/credential-service'
import {
  listAdminGitLabAccounts,
  resolveAdminGitLabAccount,
} from '@/lib/sim-search/live/gitlab-admin'
import { createNativeClient, NativeSearchError, object, string } from '@/lib/sim-search/live/http'
import { listManagedMcpSearchAccounts } from '@/lib/sim-search/live/mcp-accounts'
import {
  LIVE_SEARCH_PROVIDER_CATALOG,
  liveSearchProviderForCredential,
  SAVED_MEMBER_SEARCH_PROVIDER_IDS,
  supportsLiveSearchMode,
} from '@/lib/sim-search/live/provider-catalog'
import type { LiveAccount } from '@/lib/sim-search/live/types'

/**
 * A workspace searches the person's workspace credentials; an organization searches only the
 * accounts its members connect on the integrations page (credential-group enrollments).
 */
async function listOAuthRows(scope: ResourceScope, userId: string) {
  if (scope.kind === 'workspace') return getPersonalOAuthCredentials(scope.workspaceId, userId)
  const managed = await getOwnOrganizationManagedOAuthCredentials({
    organizationId: scope.organizationId,
    userId,
  })
  return managed.map((row) => ({ ...row, type: 'managed_oauth' as const }))
}

/** Lists only credentials created by the acting person in the authorized resource scope. */
export async function listSavedSearchCredentials(scope: ResourceScope, userId: string) {
  const rows = await db
    .select({
      id: credential.id,
      providerId: credential.providerId,
      displayName: credential.displayName,
    })
    .from(credential)
    .where(
      and(
        resourceScopeCondition(credential, scope),
        eq(credential.type, 'service_account'),
        inArray(credential.providerId, SAVED_MEMBER_SEARCH_PROVIDER_IDS),
        eq(credential.createdBy, userId),
        isNull(credential.revokedAt)
      )
    )
    .limit(ORGANIZATION_VIEWER_ACCOUNT_LIMIT)
  return rows.map((row) => ({
    ...row,
    providerId: row.providerId ?? '',
    type: 'service_account' as const,
  }))
}

/** Personal provider accounts and ACL-gated administrator-managed GitLab sources. */
export async function listLiveAccounts(
  owner: ResourceOwner,
  userId: string
): Promise<LiveAccount[]> {
  const scope = resourceScopeFromOwner(owner)
  /** A workspace's organization is known only after its context loads; an organization's is not. */
  const loadApprovals = (organizationId?: string | null) =>
    organizationId ? listOrganizationSearchApprovals(organizationId) : null
  const [oauth, saved, workspaceContext, organizationApprovals] = await Promise.all([
    listOAuthRows(scope, userId),
    listSavedSearchCredentials(scope, userId),
    scope.kind === 'workspace'
      ? resolveKnowledgeWorkspaceContext({ workspaceId: scope.workspaceId })
      : undefined,
    scope.kind === 'organization' ? loadApprovals(scope.organizationId) : null,
  ])
  const approvals =
    organizationApprovals ?? (await loadApprovals(workspaceContext?.workspaceOrganizationId))
  const denied = new Set(
    approvals
      ? liveSearchProviderSchema.options.filter((provider) => approvals.get(provider) !== true)
      : []
  )
  const candidates = [...oauth, ...saved].flatMap((row) => {
    const provider = liveSearchProviderForCredential(row.providerId)
    return provider && supportsLiveSearchMode(provider, 'member') && !denied.has(provider)
      ? [
          {
            id: row.id,
            provider,
            providerId: row.providerId,
            displayName: row.displayName,
            type: row.type,
            scopes: [] as string[],
          },
        ]
      : []
  })
  const [visible, mcp, admin] = await Promise.all([
    workspaceContext ? filterWorkspaceAccountCredentials(workspaceContext, candidates) : candidates,
    listManagedMcpSearchAccounts(owner, userId, denied),
    denied.has('gitlab') ? [] : listAdminGitLabAccounts(owner),
  ])
  if (visible.length === 0) return [...mcp, ...admin]
  // Metadata is fetched in one batch; a fresh binding check still precedes token resolution.
  const rows = await db
    .select({
      id: credential.id,
      grantedScopes: credential.grantedScopes,
      scope: account.scope,
      revokedAt: credential.revokedAt,
    })
    .from(credential)
    .leftJoin(account, eq(account.id, credential.accountId))
    .where(
      inArray(
        credential.id,
        visible.map((row) => row.id)
      )
    )
  const byId = new Map(rows.map((row) => [row.id, row]))
  return [
    ...mcp,
    ...admin,
    ...visible
      .filter((candidate) => !mcp.some((managed) => managed.provider === candidate.provider))
      .flatMap((candidate) => {
        const row = byId.get(candidate.id)
        return row && !row.revokedAt
          ? [
              {
                ...candidate,
                scopes: row.grantedScopes ?? row.scope?.split(/[ ,]+/).filter(Boolean) ?? [],
              },
            ]
          : []
      }),
  ]
}

/** Re-lists the member's accounts so a reference from an earlier request is checked afresh. */
export async function resolveLiveAccount(
  owner: ResourceOwner,
  userId: string,
  accountId: string,
  signal?: AbortSignal
) {
  const current = (await listLiveAccounts(owner, userId)).find((row) => row.id === accountId)
  if (!current)
    throw new NativeSearchError('reconnect', 'This search connection is no longer available.')
  return resolveListedLiveAccount(owner, userId, current, signal)
}

export type ResolvedLiveAccount = Awaited<ReturnType<typeof resolveListedLiveAccount>>

/**
 * Resolves credentials for an account {@link listLiveAccounts} returned earlier in the same
 * request, which already performed the binding and revocation checks.
 */
export async function resolveListedLiveAccount(
  owner: ResourceOwner,
  userId: string,
  current: LiveAccount,
  signal?: AbortSignal
) {
  if (current.type === 'admin_source') return resolveAdminGitLabAccount(owner, current)
  if (current.type === 'managed_mcp') return { account: current, accessToken: '', mcp: true }
  const scope = resourceScopeFromOwner(owner)
  if (current.type === 'managed_oauth') {
    const token = await resolveManagedOAuthToken({
      credentialId: current.id,
      ...resourceScopeFields(scope),
      expectedProviderId: current.providerId,
      requiredScopes: [],
    })
    return { account: current, accessToken: token.accessToken }
  }
  const token = await resolveCredentialTokenBundle(
    current.id,
    userId,
    'live-search',
    undefined,
    undefined,
    { signal }
  )
  if (!token) throw new NativeSearchError('reconnect', 'Reconnect your personal account.')
  const origin =
    current.provider === 'jama'
      ? token.instanceUrl
      : current.provider === 'flow'
        ? token.domain && normalizeFlowOrigin(token.domain)
        : LIVE_SEARCH_PROVIDER_CATALOG[current.provider].origin
  if (!origin)
    throw new NativeSearchError('reconnect', 'Reconnect this account to restore its API host.')
  const credentialHeaders =
    current.provider === 'flow'
      ? flowHeaders({
          accessToken: token.accessToken,
          providerWorkspaceId: token.providerWorkspaceId ?? '',
        })
      : undefined
  let connectionBinding: string | undefined
  if (current.type === 'service_account') {
    const [person] = await db
      .select({ email: user.email, verified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    const api = createNativeClient({
      origin,
      credentialHeaders,
      accessToken: token.accessToken,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    })
    const response = object(
      await api.json(
        current.provider === 'jama'
          ? '/rest/v1/users/current'
          : current.provider === 'flow'
            ? '/users/me'
            : '/apis/v1/whoami'
      )
    )
    const identity = current.provider === 'jama' ? object(response.data) : response
    if (current.provider === 'jama' || current.provider === 'flow') {
      const subject = string(identity.id)
      if (!subject)
        throw new NativeSearchError('reconnect', 'The provider did not identify this account.')
      connectionBinding = fingerprint(
        JSON.stringify([current.provider, origin, token.providerWorkspaceId ?? '', subject])
      )
    }
    const identityEmail = current.provider === 'coda' ? identity.loginId : identity.email
    const inactive =
      current.provider === 'jama'
        ? identity.active !== true
        : current.provider === 'flow'
          ? identity.deactivated_at !== null || identity.is_bot === true
          : false
    if (
      !person?.verified ||
      inactive ||
      string(identityEmail).trim().toLowerCase() !== person.email.trim().toLowerCase()
    )
      throw new NativeSearchError(
        'reconnect',
        'Use credentials for your own provider account with the same email as your verified Sim account.'
      )
  }
  return {
    account: current,
    accessToken: token.accessToken,
    origin,
    credentialHeaders,
    connectionBinding,
  }
}
