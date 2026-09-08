import { db } from '@sim/db'
import { credentialGroup, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { isPlainRecord } from '@sim/utils/object'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { getCredentialGroupIndexingConnector } from '@/lib/credential-groups/indexing'
import { ORGANIZATION_ACCOUNT_INDEXING_SOURCE_LIMIT } from '@/lib/credential-groups/limits'
import { isCredentialGroupProvider } from '@/lib/credential-groups/providers'
import { validateKnowledgeConnectorMembersBinding } from '@/lib/knowledge/connectors/member-access'

export interface SetOrganizationAccountIndexingInput {
  organizationId: string
  credentialGroupId: string
  optionId: string
  enabled: boolean
}

/** Changes every Search source bound to this org option atomically, respecting running sync leases. */
export async function setOrganizationAccountIndexing(input: SetOrganizationAccountIndexingInput) {
  const scope = { kind: 'organization' as const, organizationId: input.organizationId }
  return db.transaction(async (tx) => {
    const [group] = await tx
      .select({ options: credentialGroup.options, status: credentialGroup.status })
      .from(credentialGroup)
      .where(
        and(
          eq(credentialGroup.id, input.credentialGroupId),
          resourceScopeCondition(credentialGroup, scope)
        )
      )
      .limit(1)
      .for('update')
    if (!group)
      throw new OrchestrationError('not_found', 'Organization connected accounts were not found')
    const option = group.options.find(
      (candidate) => candidate.id === input.optionId && candidate.status === 'active'
    )
    if (!option || !isCredentialGroupProvider(option.provider))
      throw new OrchestrationError('not_found', 'Connected account provider was not found')
    const connector = getCredentialGroupIndexingConnector(option.provider)
    if (!connector)
      throw new OrchestrationError('validation', 'Indexing is not supported for this provider')
    const sources = await tx
      .select({
        id: knowledgeConnector.id,
        knowledgeBaseId: knowledgeBase.id,
        sourceConfig: knowledgeConnector.sourceConfig,
        status: knowledgeConnector.status,
        memberSyncStatus: knowledgeConnector.memberSyncStatus,
      })
      .from(knowledgeConnector)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
      .where(
        and(
          resourceScopeCondition(knowledgeBase, scope),
          eq(knowledgeBase.isSearchIndex, true),
          isNull(knowledgeBase.deletedAt),
          eq(knowledgeConnector.credentialGroupId, input.credentialGroupId),
          eq(knowledgeConnector.credentialGroupOptionId, option.id),
          eq(knowledgeConnector.connectorType, connector.type),
          eq(knowledgeConnector.accessMode, 'members'),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .orderBy(asc(knowledgeConnector.id))
      .limit(ORGANIZATION_ACCOUNT_INDEXING_SOURCE_LIMIT + 1)
      .for('update')
    if (sources.length > ORGANIZATION_ACCOUNT_INDEXING_SOURCE_LIMIT)
      throw new OrchestrationError('validation', 'Too many indexing sources for one provider')
    if (!sources.length)
      throw new OrchestrationError('not_found', 'Set up an indexing source for this provider first')
    const changed = sources.filter((source) =>
      input.enabled
        ? source.status === 'paused' ||
          source.status === 'disabled' ||
          source.memberSyncStatus === 'disabled'
        : source.status !== 'paused'
    )
    if (
      changed.some((source) => source.status === 'syncing' || source.memberSyncStatus === 'running')
    )
      throw new OrchestrationError(
        'conflict',
        'Indexing is running. Wait for the current sync to finish, then try again.'
      )
    if (input.enabled) {
      for (const source of changed) {
        if (!isPlainRecord(source.sourceConfig))
          throw new OrchestrationError('validation', 'Indexing source settings are invalid')
        const validation = validateKnowledgeConnectorMembersBinding({
          connectorMeta: connector.meta,
          group,
          credentialGroupOptionId: option.id,
          sourceConfig: source.sourceConfig,
        })
        if (!validation.ok) throw new OrchestrationError('validation', validation.message)
      }
    }
    if (changed.length) {
      const now = new Date()
      await tx
        .update(knowledgeConnector)
        .set({
          status: input.enabled ? 'active' : 'paused',
          memberSyncStatus: 'idle',
          memberSyncLockToken: null,
          memberSyncLockLeaseAt: null,
          syncLockToken: null,
          syncLockLeaseAt: null,
          nextMemberSyncAt: input.enabled ? now : null,
          updatedAt: now,
          ...(input.enabled
            ? { consecutiveFailures: 0, lastSyncError: null, lastMemberSyncError: null }
            : {}),
        })
        .where(
          and(
            inArray(
              knowledgeConnector.id,
              changed.map((source) => source.id)
            ),
            eq(knowledgeConnector.credentialGroupId, input.credentialGroupId),
            eq(knowledgeConnector.credentialGroupOptionId, option.id)
          )
        )
    }
    return {
      enabled: input.enabled,
      changed: changed.length > 0,
      providerName: connector.meta.name,
      knowledgeBaseIds: [...new Set(sources.map((source) => source.knowledgeBaseId))],
    }
  })
}
