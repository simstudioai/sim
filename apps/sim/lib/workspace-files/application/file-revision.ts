import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

/**
 * An opaque token naming the exact content of one file.
 *
 * Version numbers cannot serve as one: collaborative and workflow writes coalesce, updating the
 * current version in place rather than adding one, so a file can hold different bytes under the
 * same number. `contentUpdatedAt` advances on every content write, which is what makes a
 * conditional write refuse the change it was meant to refuse.
 *
 * The file id travels inside the token so a revision issued for one file cannot satisfy a write
 * to another that happens to share its timestamp, and so the value stays opaque rather than
 * inviting callers to synthesize one from a date they have.
 */
export function workspaceFileRevision(
  file: Pick<WorkspaceFileRecord, 'id' | 'contentUpdatedAt' | 'updatedAt'>
): string | null {
  /*
   * A record with no content timestamp cannot name its content, so it offers no revision rather
   * than one a conditional write would compare against the wrong thing.
   */
  const content = file.contentUpdatedAt ?? file.updatedAt
  if (!content) return null
  return Buffer.from(`${file.id}:${content.toISOString()}`).toString('base64url')
}

/**
 * The `revision` a response advertises, spread into the body. A record that cannot name its
 * content contributes no key rather than a null one, which is the omission every surface's
 * response schema declares.
 */
export function workspaceFileRevisionField(file: Parameters<typeof workspaceFileRevision>[0]): {
  revision?: string
} {
  const revision = workspaceFileRevision(file)
  return revision === null ? {} : { revision }
}

/**
 * Reads back a revision this surface issued for `fileId`, as the content version to guard the
 * write with. A token for another file, or one this surface never issued, is refused rather than
 * silently ignored — a caller asking for a conditional write must not get an unconditional one.
 */
export function parseWorkspaceFileRevision(revision: string, fileId: string): Date {
  const refuse = () => {
    throw new OrchestrationError(
      'validation',
      'expectedRevision is not a revision of this file; pass the one its last read or write returned'
    )
  }
  const decoded = Buffer.from(revision, 'base64url').toString('utf-8')
  const separator = decoded.indexOf(':')
  if (separator === -1 || decoded.slice(0, separator) !== fileId) refuse()
  const content = new Date(decoded.slice(separator + 1))
  if (Number.isNaN(content.getTime())) refuse()
  return content
}
