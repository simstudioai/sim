import { OrchestrationError } from '@/lib/core/orchestration/types'

/** The failure that ended a `sequential_best_effort` batch early. */
export interface BatchTerminalFailure {
  error: unknown
}

export interface BatchExecutionResult {
  terminalFailure?: BatchTerminalFailure
}

/**
 * Re-throws the failure that ended a batch early. Called after audit has been
 * projected, so the items that did commit are still recorded.
 */
export function rethrowBatchTerminalFailure(result: BatchExecutionResult): void {
  if (result.terminalFailure) throw result.terminalFailure.error
}

/** A deduplicated, bounded mixed selection of resources and folders. */
export interface BoundedResourceSelection {
  resourceIds: string[]
  folderIds: string[]
}

/**
 * Deduplicates and bounds a mixed resource/folder selection before any
 * protected row is loaded.
 *
 * The cap is on the **combined** count, not on each list: a request naming 100
 * resources and 100 folders costs twice what the ceiling is meant to allow, and
 * a folder costs more than a resource because it cascades.
 *
 * Returns neutral key names; each domain renames them so its own selection type
 * stays self-describing.
 */
export function requireBoundedResourceSelection(
  resourceIds: readonly string[],
  folderIds: readonly string[],
  maxItems: number,
  noun: { singular: string; plural: string }
): BoundedResourceSelection {
  const selection = {
    resourceIds: [...new Set(resourceIds)],
    folderIds: [...new Set(folderIds)],
  }
  const total = selection.resourceIds.length + selection.folderIds.length
  if (total === 0) {
    throw new OrchestrationError(
      'validation',
      `At least one ${noun.singular} or folder is required`
    )
  }
  if (total > maxItems) {
    throw new OrchestrationError(
      'validation',
      `Too many items (${total}). Maximum is ${maxItems} ${noun.plural} and folders combined.`
    )
  }
  return selection
}
