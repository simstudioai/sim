import { OrchestrationError } from '@/lib/core/orchestration/types'

type FolderCollection = 'cascade' | 'list' | 'path index'

/** Typed failure used when a complete folder collection cannot be materialized safely. */
export class FolderCollectionLimitExceededError extends OrchestrationError {
  constructor(collection: FolderCollection, maxRows: number) {
    super('payload_too_large', `Folder ${collection} exceeds the ${maxRows} row limit`)
    this.name = 'FolderCollectionLimitExceededError'
  }
}

/**
 * Typed refusal for a create that would push a workspace's active folder tree
 * past the ceiling its readers materialize under.
 *
 * Distinct from {@link FolderCollectionLimitExceededError}: that one reports a
 * collection that is already too large to read, which is an infrastructure
 * limit (413). This is a write the current state of the workspace conflicts
 * with (409), and its message names the action the user can take.
 */
export class FolderCollectionFullError extends OrchestrationError {
  constructor(label: string, maxRows: number) {
    super(
      'conflict',
      `This workspace has reached its limit of ${maxRows.toLocaleString('en-US')} ${label} folders. Delete folders you no longer need before creating another one.`
    )
    this.name = 'FolderCollectionFullError'
  }
}
