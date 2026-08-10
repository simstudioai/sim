import { OrchestrationError } from '@/lib/core/orchestration/types'

type FolderCollection = 'cascade' | 'list' | 'path index'

/** Typed failure used when a complete folder collection cannot be materialized safely. */
export class FolderCollectionLimitExceededError extends OrchestrationError {
  constructor(collection: FolderCollection, maxRows: number) {
    super('payload_too_large', `Folder ${collection} exceeds the ${maxRows} row limit`)
    this.name = 'FolderCollectionLimitExceededError'
  }
}
