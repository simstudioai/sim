import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

/**
 * An opaque token naming the exact content a caller read.
 *
 * Version numbers cannot serve as one: collaborative and workflow writes coalesce, updating the
 * current version in place rather than adding one, so a file can hold different bytes under the
 * same number. `contentUpdatedAt` advances on every content write, which is what makes a
 * conditional write refuse the change it was meant to refuse.
 */
export function workspaceFileRevision(
  file: Pick<WorkspaceFileRecord, 'contentUpdatedAt' | 'updatedAt'>
): string {
  return (file.contentUpdatedAt ?? file.updatedAt).toISOString()
}

/** Reads a revision a caller sent back, refusing one this surface never issued. */
export function parseWorkspaceFileRevision(revision: string): Date {
  const parsed = new Date(revision)
  if (Number.isNaN(parsed.getTime())) {
    throw new OrchestrationError(
      'validation',
      `"${revision}" is not a file revision; pass the revision an earlier read or write returned`
    )
  }
  return parsed
}
