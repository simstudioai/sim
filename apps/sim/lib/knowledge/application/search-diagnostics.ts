import type { AuthorizingUseCase } from '@/lib/core/application'
import type { knowledgeOperations } from '@/lib/knowledge/application/operations'
import type { SearchKnowledgeInput } from '@/lib/knowledge/application/search'
import {
  measureSearchStage,
  type SearchDiagnosticMetadata,
  type SearchStage,
  withSearchDiagnostics,
} from '@/lib/knowledge/search/diagnostics'

function scopeKind(input: {
  workspaceId?: string | null
  organizationId?: string | null
}): SearchDiagnosticMetadata['scopeKind'] {
  return input.organizationId ? 'organization' : input.workspaceId ? 'workspace' : undefined
}

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
          scopeKind: scopeKind(args.input),
          topK: args.input.topK,
          documentFilterCount: args.input.filters?.documentIds?.length ?? 0,
          hasSourceFilter: Boolean(args.input.filters?.source),
          hasDateFilter: Boolean(
            args.input.filters?.modifiedAfter ||
              args.input.filters?.modifiedBefore ||
              args.input.filters?.startDate ||
              args.input.filters?.endDate
          ),
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
 * Times a document read as one trace, so each read logs its own summary: the source, the
 * document's kind and size, and the window returned. A read inside a traced tool call adds to
 * that call's trace instead.
 */
export function instrumentReadUseCase<
  I extends {
    surface?: SearchDiagnosticMetadata['surface']
    workspaceId?: string | null
    organizationId?: string | null
    startOffset?: number
  },
  R,
>(
  useCase: AuthorizingUseCase<typeof knowledgeOperations.readDocument, I, R>
): AuthorizingUseCase<typeof knowledgeOperations.readDocument, I, R> {
  return {
    ...useCase,
    execute: (args) =>
      withSearchDiagnostics(
        {
          operation: 'read_document',
          ...(args.input.surface ? { surface: args.input.surface } : {}),
          principalKind: args.principal.kind,
          scopeKind: scopeKind(args.input),
          continued: Boolean(args.input.startOffset),
        },
        () => measureSearchStage('document_read', () => useCase.execute(args))
      ),
  }
}
