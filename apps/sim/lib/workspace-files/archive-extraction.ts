import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { MAX_ARCHIVE_TOTAL_BYTES, type PreparedArchiveExtraction } from '@/lib/uploads/archive'
import { createFileFolder } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  commitFileCreateInTx,
  discardStagedFileContent,
  type StagedFileContent,
  stageFileContent,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import { restoreSimPageSourceBuffer } from '@/lib/workspace-files/page-source-embed'

interface StagedArchiveEntry {
  readonly parentSegments: readonly string[]
  readonly content: StagedFileContent
}

interface StagedFileArchive {
  readonly entries: readonly StagedArchiveEntry[]
  readonly bytes: number
  readonly plan: PreparedArchiveExtraction
}

/** Releases staged objects through the existing durable compensation path. */
export async function discardFileArchive(archive: Pick<StagedFileArchive, 'entries'>) {
  const results = await Promise.allSettled(
    archive.entries.map((entry) => discardStagedFileContent(entry.content))
  )
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  )
  if (failures.length) throw new AggregateError(failures, 'Archive cleanup could not be recorded')
}

/** Inflates and stages one bounded entry at a time, without holding database locks. */
export async function stageFileArchive(
  plan: PreparedArchiveExtraction,
  args: { owner: EditableFileOwner; userId: string; signal: AbortSignal }
): Promise<StagedFileArchive> {
  const entries: StagedArchiveEntry[] = []
  let bytes = 0
  try {
    for await (const entry of plan.entries(args.signal)) {
      args.signal.throwIfAborted()
      const name = entry.segments[entry.segments.length - 1]
      const restored = restoreSimPageSourceBuffer(name, entry.buffer)
      const content = restored?.buffer ?? entry.buffer
      bytes += content.length
      if (bytes > MAX_ARCHIVE_TOTAL_BYTES) {
        throw new OrchestrationError(
          'payload_too_large',
          'Extracted content exceeds the archive limit'
        )
      }
      entries.push(
        Object.freeze({
          parentSegments: Object.freeze(entry.segments.slice(0, -1)),
          content: await stageFileContent({
            owner: args.owner,
            userId: args.userId,
            name: restored?.name ?? name,
            contentType: restored
              ? SIM_PAGE_CONTENT_TYPE
              : getMimeTypeFromExtension(getFileExtension(name)),
            content,
            signal: args.signal,
          }),
        })
      )
    }
    args.signal.throwIfAborted()
    return Object.freeze({ entries: Object.freeze(entries), bytes, plan })
  } catch (error) {
    try {
      await discardFileArchive({ entries })
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Archive staging and cleanup failed')
    }
    throw error
  }
}

/** Publishes the complete tree through canonical shared writers in the caller's transaction. */
export async function commitFileArchiveInTx(
  tx: DbTransaction,
  args: {
    owner: EditableFileOwner
    userId: string
    rootName: string
    parentId: string | null
    parentSegments: readonly string[]
    staged: StagedFileArchive
    secretProvenance: WorkspaceFileSecretProvenance
    signal: AbortSignal
  }
) {
  args.signal.throwIfAborted()
  if (!args.staged.entries.length) {
    throw new OrchestrationError('validation', 'No files could be unzipped from this archive')
  }
  const root = await createFileFolder(
    {
      owner: args.owner,
      userId: args.userId,
      name: args.rootName,
      parentId: args.parentId,
      exactName: false,
      validateResolvedName: (name) =>
        args.staged.plan.validateRootFolderSegments([...args.parentSegments, name]),
    },
    tx
  )
  const folders = new Map<string, string>([['[]', root.id]])
  const provenance: WorkspaceFileSecretProvenance =
    args.secretProvenance.status === 'unrecorded' ||
    (args.secretProvenance.status === 'exact' && args.secretProvenance.entries.length === 0)
      ? args.secretProvenance
      : { status: 'unknown' }
  for (const entry of args.staged.entries) {
    args.signal.throwIfAborted()
    let parentId = root.id
    for (let depth = 0; depth < entry.parentSegments.length; depth++) {
      const key = JSON.stringify(entry.parentSegments.slice(0, depth + 1))
      let folderId = folders.get(key)
      if (!folderId) {
        const created = await createFileFolder(
          {
            owner: args.owner,
            userId: args.userId,
            name: entry.parentSegments[depth],
            parentId,
          },
          tx
        )
        folderId = created.id
        folders.set(key, folderId)
      }
      parentId = folderId
    }
    await commitFileCreateInTx(tx, {
      owner: args.owner,
      userId: args.userId,
      staged: entry.content,
      folderId: parentId,
      exactName: false,
      secretProvenance: provenance,
    })
  }
  args.signal.throwIfAborted()
  return {
    folderId: root.id,
    folderName: root.name,
    folderDisplayPath: root.path,
    extractedCount: args.staged.entries.length,
    skippedCount: args.staged.plan.skipped,
  }
}
