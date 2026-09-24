import { db } from '@sim/db'
import { account, credential, user } from '@sim/db/schema'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { liveSearchProviderSchema } from '@/lib/api/contracts/mothership-assistant-tools'
import {
  type ResourceOwner,
  type ResourceScope,
  resourceScopeFields,
  resourceScopeFromOwner,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { filterWorkspaceAccountCredentials } from '@/lib/credentials/application/workspace-account-visibility'
import { resolveManagedOAuthToken } from '@/lib/credentials/managed-oauth'
import { getOwnOrganizationManagedOAuthCredentials } from '@/lib/credentials/organization-managed'
import { getPersonalOAuthCredentials } from '@/lib/credentials/personal'
import { resolveKnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { resolveCredentialTokenBundle } from '@/lib/oauth/credential-service'
import {
  listAdminGitLabAccounts,
  resolveAdminGitLabAccount,
} from '@/lib/sim-search/live/gitlab-admin'
import { createNativeClient, NativeSearchError, object, string } from '@/lib/sim-search/live/http'
import { listCodaMcpSearchAccounts } from '@/lib/sim-search/live/mcp-accounts'
import {
  liveSearchProviderForCredential,
  supportsLiveSearchMode,
} from '@/lib/sim-search/live/provider-catalog'
import type { LiveAccount } from '@/lib/sim-search/live/types'

async function listOAuthRows(scope: ResourceScope, userId: string) {
  if (scope.kind === 'workspace') return getPersonalOAuthCredentials(scope.workspaceId, userId)
  const [managed, personal] = await Promise.all([
    getOwnOrganizationManagedOAuthCredentials({ organizationId: scope.organizationId, userId }),
    db
      .select({
        id: credential.id,
        providerId: credential.providerId,
        displayName: credential.displayName,
      })
      .from(credential)
      .innerJoin(account, eq(account.id, credential.accountId))
      .where(
        and(
          resourceScopeCondition(credential, scope),
          eq(credential.type, 'oauth'),
          eq(account.userId, userId),
          eq(account.providerId, credential.providerId),
          ne(credential.providerId, 'slack')
        )
      ),
  ])
  return [
    ...managed.map((row) => ({ ...row, type: 'managed_oauth' as const })),
    ...personal.flatMap((row) =>
      row.providerId ? [{ ...row, providerId: row.providerId, type: 'oauth' as const }] : []
    ),
  ]
}

async function listCodaTokenRows(scope: ResourceScope, userId: string) {
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
        eq(credential.providerId, 'coda-service-account'),
        eq(credential.createdBy, userId),
        isNull(credential.revokedAt)
      )
    )
  return rows.map((row) => ({
    ...row,
    providerId: 'coda-service-account',
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
  const [oauth, coda, workspaceContext, organizationApprovals] = await Promise.all([
    listOAuthRows(scope, userId),
    listCodaTokenRows(scope, userId),
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
  const candidates = [...oauth, ...coda].flatMap((row) => {
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
    denied.has('coda') ? [] : listCodaMcpSearchAccounts(owner, userId),
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
      .filter((candidate) => candidate.provider !== 'coda' || mcp.length === 0)
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
export async function resolveLiveAccount(owner: ResourceOwner, userId: string, accountId: string) {
  const current = (await listLiveAccounts(owner, userId)).find((row) => row.id === accountId)
  if (!current)
    throw new NativeSearchError('reconnect', 'This search connection is no longer available.')
  return resolveListedLiveAccount(owner, userId, current)
}

export type ResolvedLiveAccount = Awaited<ReturnType<typeof resolveListedLiveAccount>>

/**
 * Resolves credentials for an account {@link listLiveAccounts} returned earlier in the same
 * request, which already performed the binding and revocation checks.
 */
export async function resolveListedLiveAccount(
  owner: ResourceOwner,
  userId: string,
  current: LiveAccount
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
  const token = await resolveCredentialTokenBundle(current.id, userId, 'live-search')
  if (!token) throw new NativeSearchError('reconnect', 'Reconnect your personal account.')
  if (current.type === 'service_account') {
    const [person] = await db
      .select({ email: user.email, verified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    const api = createNativeClient({
      origin: 'https://coda.io',
      accessToken: token.accessToken,
      signal: AbortSignal.timeout(10_000),
    })
    const identity = object(await api.json('/apis/v1/whoami'))
    if (
      !person?.verified ||
      string(identity.loginId).trim().toLowerCase() !== person.email.trim().toLowerCase()
    )
      throw new NativeSearchError(
        'reconnect',
        'Use a personal Coda token belonging to your verified Sim email. Shared service tokens cannot authorize personal search.'
      )
  }
  return { account: current, accessToken: token.accessToken }
}
