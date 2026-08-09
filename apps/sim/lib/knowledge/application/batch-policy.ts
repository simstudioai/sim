import { OrchestrationError } from '@/lib/core/orchestration/types'

export const MAX_KNOWLEDGE_BATCH_ITEMS = 100

export const ADD_WORKSPACE_FILES_COST_POLICY = {
  maxItems: MAX_KNOWLEDGE_BATCH_ITEMS,
  usageAdmission: 'once_before_processing',
} as const

export const BULK_DELETE_KNOWLEDGE_BASES_COST_POLICY = {
  maxItems: MAX_KNOWLEDGE_BATCH_ITEMS,
  execution: 'sequential_best_effort',
} as const

export const BULK_DELETE_KNOWLEDGE_DOCUMENTS_COST_POLICY = {
  maxItems: MAX_KNOWLEDGE_BATCH_ITEMS,
  execution: 'sequential_best_effort',
} as const

export interface KnowledgeBatchTerminalFailure {
  error: unknown
}

export interface KnowledgeBatchExecutionResult {
  terminalFailure?: KnowledgeBatchTerminalFailure
}

export function rethrowKnowledgeBatchTerminalFailure(result: KnowledgeBatchExecutionResult): void {
  if (result.terminalFailure) throw result.terminalFailure.error
}

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
