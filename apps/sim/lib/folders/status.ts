import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'

/**
 * Folder mutations can fail for one reason the shared orchestration vocabulary has no word
 * for: a resource inside the folder carries a mutation lock. Kept as a folder-local widening
 * rather than pushed into `OrchestrationErrorCode`, which is shared with deployment and
 * workflow surfaces that have no such state.
 */
export type FolderMutationErrorCode = OrchestrationErrorCode | 'locked'

/**
 * Maps a folder mutation error code to its HTTP status. Shared by every folder route so the
 * surfaces cannot drift — `locked` in particular must reach the client as 423, matching what
 * the table domain returns when the same lock blocks a single-table delete.
 *
 * Deliberately kept out of `lib/folders/lifecycle.ts`: this is a pure mapping with no
 * database access, and routes need it to stay real in tests that mock the lifecycle module.
 */
export function folderMutationStatus(errorCode: FolderMutationErrorCode | undefined): number {
  if (errorCode === 'validation') return 400
  if (errorCode === 'not_found') return 404
  if (errorCode === 'conflict') return 409
  if (errorCode === 'locked') return 423
  return 500
}
