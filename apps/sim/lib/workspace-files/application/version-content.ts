import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { hasObjectNotFoundCause } from '@/lib/uploads/core/errors'
import { parseWorkspaceFileRevision } from '@/lib/workspace-files/application/file-revision'

/** Checks exact content before even a no-op revert, independently of coalesced history numbers. */
export function assertFileVersionRevision(
  file: Pick<WorkspaceFileRecord, 'id' | 'contentUpdatedAt' | 'updatedAt'>,
  expectedRevision: string | undefined,
  conflictMessage: string
): Date | undefined {
  if (!expectedRevision) return undefined
  const expected = parseWorkspaceFileRevision(expectedRevision, file.id)
  if ((file.contentUpdatedAt ?? file.updatedAt).getTime() !== expected.getTime()) {
    throw new OrchestrationError('conflict', conflictMessage)
  }
  return expected
}

/** Maps an object removed after its version was loaded to the same missing-version response. */
export async function readFileVersionObject<T>(
  version: number,
  read: () => Promise<T>
): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (hasObjectNotFoundCause(error)) {
      throw new OrchestrationError('not_found', `Version ${version} not found`)
    }
    throw error
  }
}
