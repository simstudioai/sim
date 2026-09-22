import { db } from '@sim/db'
import { account, credential, organizationSearchIntegration, user } from '@sim/db/schema'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { LiveSearchProvider } from '@/lib/api/contracts/mothership-assistant-tools'
import {
  type ResourceOwner,
  resourceScopeFields,
  resourceScopeFromOwner,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { filterWorkspaceAccountCredentials } from '@/lib/credentials/application/workspace-account-visibility'
import { decryptPersonalToken } from '@/lib/credentials/gitlab-personal-token'
import { resolveManagedOAuthToken } from '@/lib/credentials/managed-oauth'
import { getOwnOrganizationManagedOAuthCredentials } from '@/lib/credentials/organization-managed'
import { getPersonalOAuthCredentials } from '@/lib/credentials/personal'
import {
  getPersonalTokenCredentials,
  requirePersonalTokenEnrollment,
} from '@/lib/credentials/personal-tokens'
import { resolveKnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'
import { resolveCredentialTokenBundle } from '@/lib/oauth/credential-service'
import { createNativeClient, NativeSearchError, object, string } from '@/lib/sim-search/live/http'
import { listCodaMcpSearchAccounts } from '@/lib/sim-search/live/mcp-accounts'
import type { LiveAccount } from '@/lib/sim-search/live/types'

const PROVIDERS: Readonly<Record<string, LiveSearchProvider>> = {
  'google-drive': 'google_drive',
  'google-docs': 'google_drive',
  'google-sheets': 'google_drive',
  'google-slides': 'google_drive',
  'google-email': 'gmail',
  gmail: 'gmail',
  'google-calendar': 'google_calendar',
  slack: 'slack',
  jira: 'jira',
  confluence: 'confluence',
  'github-repositories': 'github',
  gitlab: 'gitlab',
  'coda-service-account': 'coda',
}

/** No index lookup, no shared bot token, and no substitution of the organization's admin. */
export async function listLiveAccounts(
  owner: ResourceOwner,
  userId: string
): Promise<LiveAccount[]> {
  const scope = resourceScopeFromOwner(owner)
  const oauth =
    scope.kind === 'workspace'
      ? await getPersonalOAuthCredentials(scope.workspaceId, userId)
      : [
          ...(
            await getOwnOrganizationManagedOAuthCredentials({
              organizationId: scope.organizationId,
              userId,
            })
          ).map((row) => ({ ...row, type: 'managed_oauth' as const })),
          ...(
            await db
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
              )
          ).flatMap((row) =>
            row.providerId ? [{ ...row, providerId: row.providerId, type: 'oauth' as const }] : []
          ),
        ]
  const personal =
    scope.kind === 'workspace'
      ? await getPersonalTokenCredentials(scope.workspaceId, userId)
      : (
          await db
            .select({
              id: credential.id,
              providerId: credential.providerId,
              displayName: credential.displayName,
            })
            .from(credential)
            .where(
              and(
                resourceScopeCondition(credential, scope),
                eq(credential.type, 'personal_token'),
                eq(credential.createdBy, userId),
                isNull(credential.revokedAt)
              )
            )
        ).flatMap((row) =>
          row.providerId
            ? [{ ...row, providerId: row.providerId, type: 'personal_token' as const }]
            : []
        )
  const workspaceContext =
    scope.kind === 'workspace'
      ? await resolveKnowledgeWorkspaceContext({ workspaceId: scope.workspaceId })
      : undefined
  const organizationId =
    scope.kind === 'organization' ? scope.organizationId : workspaceContext?.workspaceOrganizationId
  const decisions = organizationId
    ? await db
        .select({
          provider: organizationSearchIntegration.connectorType,
          approved: organizationSearchIntegration.approved,
        })
        .from(organizationSearchIntegration)
        .where(eq(organizationSearchIntegration.organizationId, organizationId))
    : []
  const denied = new Set(decisions.filter((row) => !row.approved).map((row) => row.provider))
  const coda = (
    await db
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
  ).map((row) => ({ ...row, providerId: 'coda-service-account', type: 'service_account' as const }))
  const candidates = [...oauth, ...personal, ...coda].flatMap((row) => {
    const provider = PROVIDERS[row.providerId]
    return provider && !denied.has(provider)
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
  const visible = workspaceContext
    ? await filterWorkspaceAccountCredentials(workspaceContext, candidates)
    : candidates
  const mcp = denied.has('coda') ? [] : await listCodaMcpSearchAccounts(owner, userId)
  if (visible.length === 0) return mcp
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

export async function resolveLiveAccount(owner: ResourceOwner, userId: string, accountId: string) {
  const current = (await listLiveAccounts(owner, userId)).find((row) => row.id === accountId)
  if (!current)
    throw new NativeSearchError('reconnect', 'This personal account is no longer available.')
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
  if (current.type === 'personal_token') {
    const [row] = await db.select().from(credential).where(eq(credential.id, current.id)).limit(1)
    if (
      !row ||
      row.createdBy !== userId ||
      row.providerId !== 'gitlab' ||
      !row.encryptedPersonalToken ||
      !row.providerSubjectId ||
      !row.providerTenantId ||
      row.revokedAt ||
      (row.accessTokenExpiresAt && row.accessTokenExpiresAt <= new Date())
    )
      throw new NativeSearchError('reconnect', 'Reconnect your personal GitLab token.')
    await requirePersonalTokenEnrollment({
      ...resourceScopeFields(resourceScopeFromOwner(row)),
      userId,
      enrollmentId: row.credentialGroupEnrollmentId,
    })
    const accessToken = await decryptPersonalToken(row.encryptedPersonalToken, {
      providerId: 'gitlab',
      ownerUserId: userId,
      ...resourceScopeFields(resourceScopeFromOwner(row)),
      subjectId: row.providerSubjectId,
      instanceUrl: row.providerTenantId,
    })
    return { account: current, accessToken, origin: row.providerTenantId }
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
