import { db } from '@sim/db'
import { credential, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { ResourceOwner } from '@/lib/core/resource-scope'
import { requireSourceMirroredAccessAvailable } from '@/lib/knowledge/access/availability'
import { resolveKnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'
import { searchIntegrationAccessCondition } from '@/lib/knowledge/search/integration-policy'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import { NativeSearchError, object } from '@/lib/sim-search/live/http'

async function organizationIdFor(owner: ResourceOwner) {
  return (
    owner.organizationId ??
    (owner.workspaceId
      ? (await resolveKnowledgeWorkspaceContext({ workspaceId: owner.workspaceId }))
          .workspaceOrganizationId
      : undefined)
  )
}

/** Loads a live source only after the calling search or settings use case authorizes its owner. */
export async function loadLiveServiceSource(
  owner: ResourceOwner,
  provider: string,
  sourceId: string,
  options: { requireApproved?: boolean } = {}
) {
  const organizationId = await organizationIdFor(owner)
  if (!organizationId)
    throw new NativeSearchError(
      'unavailable',
      'Service account search requires an organization source.'
    )
  await requireSourceMirroredAccessAvailable({ organizationId })
  const [source] = await db
    .select({
      id: knowledgeConnector.id,
      connectorType: knowledgeConnector.connectorType,
      sourceConfig: knowledgeConnector.sourceConfig,
      credentialId: knowledgeConnector.credentialId,
      encryptedApiKey: knowledgeConnector.encryptedApiKey,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(
      and(
        eq(knowledgeBase.organizationId, organizationId),
        eq(knowledgeBase.isSearchIndex, true),
        eq(knowledgeConnector.id, sourceId),
        eq(knowledgeConnector.connectorType, provider),
        eq(knowledgeConnector.accessMode, 'admin'),
        inArray(knowledgeConnector.status, ['active', 'pending', 'syncing', 'error']),
        isNull(knowledgeBase.deletedAt),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeConnector.archivedAt),
        options.requireApproved !== false ? searchIntegrationAccessCondition() : undefined
      )
    )
    .limit(1)
  if (!source)
    throw new NativeSearchError(
      'unavailable',
      'The configured service account source is unavailable. Ask an admin to check Sources.'
    )
  return { ...source, config: object(source.sourceConfig), organizationId }
}

export type LiveServiceSource = Awaited<ReturnType<typeof loadLiveServiceSource>>

/** GitHub App sources are one repository each; member-sync observations are not used by live search. */
export async function loadLiveGitHubSources(owner: ResourceOwner) {
  const organizationId = await organizationIdFor(owner)
  if (!organizationId)
    throw new NativeSearchError('unavailable', 'GitHub App search requires an organization.')
  const rows = await db
    .select({
      id: knowledgeConnector.id,
      sourceConfig: knowledgeConnector.sourceConfig,
      credentialId: credential.id,
      encryptedKey: credential.encryptedServiceAccountKey,
      installationId: credential.providerSubjectId,
      accountId: credential.providerTenantId,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .innerJoin(credential, eq(credential.id, knowledgeConnector.credentialId))
    .where(
      and(
        eq(knowledgeBase.organizationId, organizationId),
        eq(knowledgeBase.isSearchIndex, true),
        isNull(knowledgeBase.deletedAt),
        eq(knowledgeConnector.connectorType, 'github'),
        eq(knowledgeConnector.accessMode, 'members'),
        inArray(knowledgeConnector.status, ['active', 'pending', 'syncing', 'error']),
        ne(knowledgeConnector.memberSyncStatus, 'disabled'),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeConnector.archivedAt),
        sql`${knowledgeConnector.sourceConfig}::jsonb ? 'githubRepositoryId'`,
        eq(credential.organizationId, organizationId),
        eq(credential.type, 'service_account'),
        eq(credential.providerId, GITHUB_INSTALLATION_PROVIDER_ID),
        isNull(credential.revokedAt),
        searchIntegrationAccessCondition()
      )
    )
    .limit(101)
  if (rows.length > 100)
    throw new NativeSearchError(
      'unavailable',
      'GitHub search supports up to 100 configured repositories. Narrow the sources before searching.'
    )
  return rows.map((row) => ({ ...row, config: object(row.sourceConfig) }))
}

export type LiveGitHubSource = Awaited<ReturnType<typeof loadLiveGitHubSources>>[number]
