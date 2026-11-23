import {
  type OrchestrationErrorCode,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'

/**
 * Maps a folder mutation error code to its HTTP status. Shared by every folder route so the
 * surfaces cannot drift.
 *
 * Folder routes authorize the caller before mutating, so an `unauthorized` or `forbidden`
 * raised inside a mutation is a fault, not a verdict on the caller, and stays a 500.
 *
 * Deliberately kept out of `lib/folders/orchestration.ts`: this is a pure mapping with no
 * database access, and routes need it to stay real in tests that mock the lifecycle module.
 */
export function folderMutationStatus(errorCode: OrchestrationErrorCode | undefined): number {
  if (errorCode === 'unauthorized' || errorCode === 'forbidden') return 500
  return statusForOrchestrationError(errorCode)
}
