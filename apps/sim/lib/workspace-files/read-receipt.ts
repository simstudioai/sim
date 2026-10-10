import { type WorkspaceFileRow, workspaceFiles } from '@sim/db/schema'
import { and, asc, inArray, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import {
  getBoundWorkspaceFileSecretProvenanceByMetadata,
  mergeWorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

export interface FileReadReceipt {
  readonly owner: Readonly<EditableFileOwner>
  readonly files: readonly Readonly<{ id: string; key: string; revision: number }>[]
}

/** A private immutable description of the canonical bytes consumed by a composite read. */
export function createFileReadReceipt(
  owner: EditableFileOwner,
  files: readonly Pick<WorkspaceFileRow, 'id' | 'key' | 'contentUpdatedAt'>[]
): FileReadReceipt {
  return Object.freeze({
    owner: Object.freeze({ ...owner }),
    files: Object.freeze(
      files.map((file) =>
        Object.freeze({
          id: file.id,
          key: file.key,
          revision: file.contentUpdatedAt.getTime(),
        })
      )
    ),
  })
}

/** The application already holds current owner authority; reject stale bytes and read current labels. */
export async function recheckFileReadReceipt(tx: DbTransaction, receipt: FileReadReceipt) {
  if (receipt.files.length === 0) return mergeWorkspaceFileSecretProvenance()
  const rows = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        fileOwnerCondition(receipt.owner),
        inArray(
          workspaceFiles.id,
          receipt.files.map((file) => file.id)
        ),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .orderBy(asc(workspaceFiles.id))
    .for('share')
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const expected of receipt.files) {
    const actual = byId.get(expected.id)
    if (
      !actual ||
      actual.key !== expected.key ||
      actual.contentUpdatedAt.getTime() !== expected.revision
    )
      throw new OrchestrationError('conflict', 'A file changed while preparing the download')
  }
  const provenance = await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, rows)
  return mergeWorkspaceFileSecretProvenance(...provenance.values())
}
