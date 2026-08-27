import {
  type BatchExecutionResult,
  type BatchTerminalFailure,
  requireBoundedResourceSelection,
  rethrowBatchTerminalFailure,
} from '@/lib/core/application/batch-policy'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_KNOWLEDGE_BATCH_ITEMS } from '@/lib/knowledge/constants'

export const ADD_WORKSPACE_FILES_COST_POLICY = {
  maxItems: MAX_KNOWLEDGE_BATCH_ITEMS,
  usageAdmission: 'once_before_processing',
} as const

export const BULK_MOVE_KNOWLEDGE_ITEMS_COST_POLICY = {
  maxItems: MAX_KNOWLEDGE_BATCH_ITEMS,
  execution: 'sequential_best_effort',
} as const

export const BULK_DELETE_KNOWLEDGE_ITEMS_COST_POLICY = {
  maxItems: MAX_KNOWLEDGE_BATCH_ITEMS,
  execution: 'sequential_best_effort',
} as const

export const BULK_DELETE_KNOWLEDGE_BASES_COST_POLICY = {
  maxItems: MAX_KNOWLEDGE_BATCH_ITEMS,
  execution: 'sequential_best_effort',
} as const

export const BULK_DELETE_KNOWLEDGE_DOCUMENTS_COST_POLICY = {
  maxItems: MAX_KNOWLEDGE_BATCH_ITEMS,
  execution: 'sequential_best_effort',
} as const

/** Domain names for the shared batch shapes, so call sites read in knowledge terms. */
export type KnowledgeBatchTerminalFailure = BatchTerminalFailure
export type KnowledgeBatchExecutionResult = BatchExecutionResult

/**
 * Re-throws the failure that ended a batch early. Called after audit has been
 * projected, so the items that did commit are still recorded.
 */
export const rethrowKnowledgeBatchTerminalFailure: (result: KnowledgeBatchExecutionResult) => void =
  rethrowBatchTerminalFailure

export function requireBoundedKnowledgeBatch(
  items: readonly string[],
  resource: string,
  maxItems: number
): string[] {
  if (items.length === 0) {
    throw new OrchestrationError('validation', `At least one ${resource} is required`)
  }
  if (items.length > maxItems) {
    throw new OrchestrationError(
      'validation',
      `Too many ${resource} (${items.length}). Maximum is ${maxItems}.`
    )
  }
  return [...new Set(items)]
}

export interface BoundedKnowledgeSelection {
  knowledgeBaseIds: string[]
  folderIds: string[]
}

/**
 * Deduplicates and bounds a mixed knowledge-base/folder selection before any
 * protected row is loaded. The cap is on the combined count — see
 * {@link requireBoundedResourceSelection}.
 */
export function requireBoundedKnowledgeSelection(
  knowledgeBaseIds: readonly string[],
  folderIds: readonly string[],
  maxItems: number
): BoundedKnowledgeSelection {
  const selection = requireBoundedResourceSelection(knowledgeBaseIds, folderIds, maxItems, {
    singular: 'knowledge base',
    plural: 'knowledge bases',
  })
  return { knowledgeBaseIds: selection.resourceIds, folderIds: selection.folderIds }
}
