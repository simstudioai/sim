import type { AuthorizingUseCase } from '@/lib/core/application'
import type { ResourceOwner } from '@/lib/core/resource-scope'
import type { knowledgeOperations } from '@/lib/knowledge/application/operations'
import type { SearchKnowledgeInput } from '@/lib/knowledge/application/search'
import {
  measureSearchStage,
  type SearchStage,
  withSearchDiagnostics,
} from '@/lib/knowledge/search/diagnostics'

/** Preserve the operation and authorization contract while timing the whole use case. */
export function instrumentSearchUseCase<
  I extends Omit<SearchKnowledgeInput, 'knowledgeBaseIds' | 'workspaceId' | 'organizationId'> & {
    workspaceId?: string | null
    organizationId?: string | null
  },
  R,
>(
  stage: Extract<SearchStage, `${string}_application`>,
  useCase: AuthorizingUseCase<typeof knowledgeOperations.search, I, R>
): AuthorizingUseCase<typeof knowledgeOperations.search, I, R> {
  return {
    ...useCase,
    execute: (args) =>
      withSearchDiagnostics(
        {
          surface: args.input.surface ?? 'other',
          principalKind: args.principal.kind,
          scopeKind: args.input.organizationId
            ? 'organization'
            : args.input.workspaceId
              ? 'workspace'
              : undefined,
          topK: args.input.topK,
          documentFilterCount: args.input.filters?.documentIds?.length ?? 0,
          hasSourceFilter: Boolean(args.input.filters?.source),
          hasDateFilter: Boolean(args.input.filters?.modifiedAfter),
          tagFilterCount: args.input.tagFilters?.length ?? 0,
          hasProvenance: Boolean(
            args.input.resultSecretRegistry || args.input.prepareModelInputProvenance
          ),
        },
        () => measureSearchStage(stage, () => useCase.execute(args))
      ),
  }
}

/**
 * Times the source overview, whose cost is access batching and live source proof rather than
 * retrieval. It shares the search trace so one log line explains a slow Sim Search surface.
 */
export function instrumentSourceOverviewUseCase<I extends ResourceOwner, R>(
  useCase: AuthorizingUseCase<typeof knowledgeOperations.readSearchSourceOverview, I, R>
): AuthorizingUseCase<typeof knowledgeOperations.readSearchSourceOverview, I, R> {
  return {
    ...useCase,
    execute: (args) =>
      withSearchDiagnostics(
        {
          operation: 'read_search_source_overview',
          principalKind: args.principal.kind,
          /** Derived without `resourceScopeFromOwner`, which throws before authorization runs. */
          scopeKind: args.input.organizationId
            ? 'organization'
            : args.input.workspaceId
              ? 'workspace'
              : undefined,
        },
        () => measureSearchStage('source_overview', () => useCase.execute(args))
      ),
  }
}
