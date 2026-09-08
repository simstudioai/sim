import { db } from '@sim/db'
import { document, embedding, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { and, eq, exists, inArray, isNull, notInArray, or } from 'drizzle-orm'
import type { SearchSourceOverview } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { MAX_SEARCH_SOURCE_PROVIDER_TYPES } from '@/lib/knowledge/constants'
import { searchIntegrationAccessCondition } from '@/lib/knowledge/search/integration-policy'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

/** Provider-level existence probes keep setup cards independent of the loaded source pages. */
export const readSearchSourceOverview = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readSearchSourceOverview,
  resolveContext: ({ input }: { input: ResourceOwner }) => resolveKnowledgeOwnerContext(input),
  async execute({ principal, context }): Promise<SearchSourceOverview> {
    const [availability, access] = await Promise.all([
      resolveKnowledgeAccessAvailability(context),
      createKnowledgeAccessProvider(principal, context).get(),
    ])
    const providerTypes = Object.keys(CONNECTOR_META_REGISTRY)
    if (providerTypes.length > MAX_SEARCH_SOURCE_PROVIDER_TYPES) {
      throw new Error('Search provider catalog exceeds the overview bound')
    }
    const configured = and(
      resourceScopeCondition(knowledgeBase, resourceScopeFromOwner(context)),
      eq(knowledgeBase.isSearchIndex, true),
      isNull(knowledgeBase.deletedAt),
      inArray(knowledgeConnector.connectorType, providerTypes),
      inArray(knowledgeConnector.accessMode, ['admin', 'members']),
      isNull(knowledgeConnector.archivedAt),
      isNull(knowledgeConnector.deletedAt)
    )
    const available = or(
      availability.memberScoped ? eq(knowledgeConnector.accessMode, 'members') : undefined,
      availability.sourceMirrored
        ? and(
            eq(knowledgeConnector.accessMode, 'admin'),
            inArray(
              knowledgeConnector.connectorType,
              providerTypes.filter(
                (type) =>
                  availability.memberScoped || !CONNECTOR_META_REGISTRY[type].requiresMemberIdentity
              )
            )
          )
        : undefined
    )
    const syncingEnabled = and(
      available,
      searchIntegrationAccessCondition(),
      notInArray(knowledgeConnector.status, ['paused', 'disabled']),
      or(
        eq(knowledgeConnector.accessMode, 'admin'),
        notInArray(knowledgeConnector.memberSyncStatus, ['disabled'])
      )
    )
    const readableDocument = and(
      eq(document.connectorId, knowledgeConnector.id),
      eq(document.knowledgeBaseId, knowledgeConnector.knowledgeBaseId),
      eq(document.enabled, true),
      eq(document.userExcluded, false),
      isNull(document.archivedAt),
      isNull(document.deletedAt),
      knowledgeAccessCondition(access)
    )
    const providersQuery = () =>
      db
        .selectDistinct({ connectorType: knowledgeConnector.connectorType })
        .from(knowledgeConnector)
        .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    const [providers, indexing, searchable] = await Promise.all([
      providersQuery().where(configured).limit(MAX_SEARCH_SOURCE_PROVIDER_TYPES),
      availability.memberScoped || availability.sourceMirrored
        ? providersQuery()
            .where(
              and(
                configured,
                syncingEnabled,
                or(
                  inArray(knowledgeConnector.status, ['pending', 'syncing']),
                  and(
                    eq(knowledgeConnector.accessMode, 'members'),
                    inArray(knowledgeConnector.memberSyncStatus, ['pending', 'running'])
                  ),
                  exists(
                    db
                      .select({ id: document.id })
                      .from(document)
                      .where(
                        and(
                          readableDocument,
                          inArray(document.processingStatus, ['pending', 'processing'])
                        )
                      )
                  )
                )
              )
            )
            .limit(MAX_SEARCH_SOURCE_PROVIDER_TYPES)
        : [],
      availability.memberScoped || availability.sourceMirrored
        ? db
            .select({ id: document.id })
            .from(document)
            .innerJoin(knowledgeConnector, eq(knowledgeConnector.id, document.connectorId))
            .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
            .where(
              and(
                configured,
                available,
                readableDocument,
                eq(document.processingStatus, 'completed'),
                exists(
                  db
                    .select({ id: embedding.id })
                    .from(embedding)
                    .where(and(eq(embedding.documentId, document.id), eq(embedding.enabled, true)))
                )
              )
            )
            .limit(1)
        : [],
    ])
    const indexingTypes = new Set(indexing.map((provider) => provider.connectorType))
    return {
      providers: providers.map(({ connectorType }) => ({
        connectorType,
        isSyncing: indexingTypes.has(connectorType),
      })),
      hasSearchableDocuments: searchable.length > 0,
    }
  },
})
