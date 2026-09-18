import { db } from '@sim/db'
import { document, embedding, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { and, eq, exists, inArray, isNull, notInArray, or } from 'drizzle-orm'
import type { SearchSourceOverview } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { instrumentSourceOverviewUseCase } from '@/lib/knowledge/application/search-diagnostics'
import { MAX_SEARCH_SOURCE_PROVIDER_TYPES } from '@/lib/knowledge/constants'
import { knowledgeReadAccessBatches } from '@/lib/knowledge/read-access'
import { annotateSearchDiagnostics, measureSearchStage } from '@/lib/knowledge/search/diagnostics'
import { searchIntegrationAccessCondition } from '@/lib/knowledge/search/integration-policy'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

function searchProviderTypes() {
  const providerTypes = Object.keys(CONNECTOR_META_REGISTRY)
  if (providerTypes.length > MAX_SEARCH_SOURCE_PROVIDER_TYPES) {
    throw new Error('Search provider catalog exceeds the overview bound')
  }
  return providerTypes
}

/** Live search-index sources of a known provider, over `knowledge_connector` joined to its base. */
function configuredSearchSourceCondition(owner: ResourceOwner, providerTypes: string[]) {
  return and(
    resourceScopeCondition(knowledgeBase, resourceScopeFromOwner(owner)),
    eq(knowledgeBase.isSearchIndex, true),
    isNull(knowledgeBase.deletedAt),
    inArray(knowledgeConnector.connectorType, providerTypes),
    inArray(knowledgeConnector.accessMode, ['admin', 'members']),
    isNull(knowledgeConnector.archivedAt),
    isNull(knowledgeConnector.deletedAt)
  )
}

function configuredProvidersQuery() {
  return db
    .selectDistinct({ connectorType: knowledgeConnector.connectorType })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
}

/**
 * Provider types with at least one configured search source in an already authorized owner.
 * Reads no documents, so callers needing only setup state avoid the overview's access probes.
 */
export async function listConfiguredSearchProviderTypes(owner: ResourceOwner): Promise<string[]> {
  const rows = await configuredProvidersQuery()
    .where(configuredSearchSourceCondition(owner, searchProviderTypes()))
    .limit(MAX_SEARCH_SOURCE_PROVIDER_TYPES)
  return rows.map(({ connectorType }) => connectorType)
}

/** Provider-level existence probes keep setup cards independent of the loaded source pages. */
export const readSearchSourceOverview = instrumentSourceOverviewUseCase(
  defineAuthorizedKnowledgeUseCase({
    operation: knowledgeOperations.readSearchSourceOverview,
    resolveContext: ({ input }: { input: ResourceOwner }) => resolveKnowledgeOwnerContext(input),
    async execute({ principal, context }): Promise<SearchSourceOverview> {
      const availability = await measureSearchStage('source_overview.availability', () =>
        resolveKnowledgeAccessAvailability(context)
      )
      const access = createKnowledgeAccessProvider(principal, context)
      const providerTypes = searchProviderTypes()
      const configured = configuredSearchSourceCondition(context, providerTypes)
      const available = or(
        availability.memberScoped ? eq(knowledgeConnector.accessMode, 'members') : undefined,
        availability.sourceMirrored
          ? and(
              eq(knowledgeConnector.accessMode, 'admin'),
              inArray(
                knowledgeConnector.connectorType,
                providerTypes.filter(
                  (type) =>
                    availability.memberScoped ||
                    !CONNECTOR_META_REGISTRY[type].requiresMemberIdentity
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
      const documentConditions = and(
        eq(document.connectorId, knowledgeConnector.id),
        eq(document.knowledgeBaseId, knowledgeConnector.knowledgeBaseId),
        eq(document.enabled, true),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
      const providers = await measureSearchStage('source_overview.providers', () =>
        configuredProvidersQuery().where(configured).limit(MAX_SEARCH_SOURCE_PROVIDER_TYPES)
      )
      annotateSearchDiagnostics({ configuredProviderCount: providers.length })
      const indexingTypes = new Set<string>()
      let searchableProbes = 0
      let hasSearchableDocuments = false
      for await (const accessCondition of knowledgeReadAccessBatches(access, [
        configured,
        available,
        documentConditions,
      ])) {
        const readableDocument = and(documentConditions, accessCondition)
        const probesSources: boolean = availability.memberScoped || availability.sourceMirrored
        /** One searchable document is the whole answer, so later batches skip the probe entirely. */
        const probesSearchable: boolean = probesSources && !hasSearchableDocuments
        if (probesSearchable) searchableProbes += 1
        /**
         * A provider type is only read back as membership of `indexingTypes`, so once every
         * configured type is in the set no later batch can change the answer.
         */
        const probesIndexing: boolean =
          probesSources && providers.some(({ connectorType }) => !indexingTypes.has(connectorType))
        /** Annotated so the searchable probe's guard does not infer through its own result. */
        const [indexing, searchable]: [{ connectorType: string }[], { id: string }[]] =
          await Promise.all([
            probesIndexing
              ? measureSearchStage('source_overview.indexing', () =>
                  configuredProvidersQuery()
                    .where(
                      and(
                        configured,
                        syncingEnabled,
                        /**
                         * The probe narrows the configured set the provider list came from, so a
                         * type already found stays found; excluding it only drops repeated work.
                         * An empty set adds no predicate rather than a no-op one.
                         */
                        indexingTypes.size > 0
                          ? notInArray(knowledgeConnector.connectorType, [...indexingTypes])
                          : undefined,
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
                )
              : [],
            probesSearchable
              ? measureSearchStage('source_overview.searchable', () =>
                  db
                    .select({ id: document.id })
                    .from(document)
                    .innerJoin(knowledgeConnector, eq(knowledgeConnector.id, document.connectorId))
                    .innerJoin(
                      knowledgeBase,
                      eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId)
                    )
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
                            .where(
                              and(
                                eq(embedding.documentId, document.id),
                                eq(embedding.enabled, true)
                              )
                            )
                        )
                      )
                    )
                    .limit(1)
                )
              : [],
          ])
        for (const provider of indexing) indexingTypes.add(provider.connectorType)
        hasSearchableDocuments ||= searchable.length > 0
      }
      annotateSearchDiagnostics({ searchableProbeCount: searchableProbes })
      return {
        providers: providers.map(({ connectorType }) => ({
          connectorType,
          isSyncing: indexingTypes.has(connectorType),
        })),
        hasSearchableDocuments,
      }
    },
  })
)
