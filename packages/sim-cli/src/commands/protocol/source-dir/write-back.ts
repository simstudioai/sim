/**
 * Saving a server answer (a get's, or a stored write's) into a workflow source directory: its
 * files, lock and base in one staged update, and the records that say the CLI wrote them.
 */

import { toRecord } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import { codeFileReferences } from '@sim/workflow-code/code-files/references'
import {
  isCodeFilePath,
  SOURCE_BASE_FILE,
  SOURCE_ENTRY_FILE,
  SOURCE_LOCK_FILE,
} from '@sim/workflow-code/limits'
import { fingerprintOf } from '@sim/workspace-code'
import { printError } from '#sim-cli/output/io'
import { type WorkspaceFolder, workspaceFolderOf } from './dir-kind'
import { readSourceJson, readSourceText, type SourceDirChange, updateSourceDir } from './files'
import {
  lockCodeFiles,
  orphanedCodeFiles,
  SOURCE_WRITTEN_FILE,
  sourceRelativePath,
  writableFiles,
} from './layout'
import {
  digest,
  inWorkspace,
  type PrintedSourceAnswer,
  readFolderWritten,
  readWritten,
  writtenFiles,
  writtenRecord,
} from './written'

/**
 * Records a single-workflow write into workflow folder `folder` in the workspace records: each
 * written file's digest (`written`, folder-relative path → text) replaces the one before, a
 * `removed` file's is dropped, and the workspace base's entry for the workflow takes the
 * fingerprint of the folder's new base, as a workspace get would record it. Written after the
 * folder's files, so a write cut short leaves the old records.
 */
async function recordFolderWrite(
  folder: WorkspaceFolder,
  written: Record<string, string>,
  removed: readonly string[],
  base: unknown
): Promise<void> {
  const record = await readWritten(folder.root)
  const dropped = new Set(removed.map((path) => inWorkspace(folder.key, path)))
  const digests = {
    ...Object.fromEntries(Object.entries(record.digests).filter(([path]) => !dropped.has(path))),
    ...Object.fromEntries(
      Object.entries(written).map(([path, text]) => [inWorkspace(folder.key, path), digest(text)])
    ),
  }
  const write: Array<readonly [string, string]> = [
    ...writtenFiles({ digests, stats: record.stats }),
  ]
  const workspaceBase = toRecord(await readSourceJson(folder.root, SOURCE_BASE_FILE))
  const resources = toRecord(workspaceBase.resources)
  const address = `workflow:${folder.key}`
  const entry = toRecord(resources[address])
  const { workflowId, fingerprint } = toRecord(base)
  if (entry.id === workflowId && typeof fingerprint === 'string') {
    const next = {
      ...workspaceBase,
      resources: {
        ...resources,
        [address]: { ...entry, fingerprint: fingerprintOf({ source: fingerprint }) },
      },
    }
    write.push([SOURCE_BASE_FILE, `${JSON.stringify(next, null, 2)}\n`])
  }
  await updateSourceDir(folder.root, { write })
}

/**
 * Writes a server answer into the source directory in one staged update: its files, lock and base,
 * plus `extra`, pruning the function files the previous lock named and the new one no longer does.
 * Returns how many files it wrote. A get refuses an unsafe path first
 * ({@link assertPrintedSourcePaths}); after a stored write one is skipped ({@link writableFiles}).
 */
export async function writeBack(
  dir: string,
  answer: PrintedSourceAnswer,
  previousLock: unknown,
  extra: SourceDirChange = { write: [] }
): Promise<number> {
  const files = writableFiles(answer.files)
  const folder = await workspaceFolderOf(dir)
  const printed: Array<readonly [string, string]> = [
    ...Object.entries(files),
    [SOURCE_LOCK_FILE, `${JSON.stringify(answer.lock, null, 2)}\n`],
    [SOURCE_BASE_FILE, `${JSON.stringify(answer.base, null, 2)}\n`],
  ]
  const write = [...printed, ...(folder ? [] : writtenFiles(writtenRecord(files))), ...extra.write]
  const orphaned = orphanedCodeFiles(
    previousLock,
    answer.lock,
    Object.keys(answer.files),
    (await readFolderWritten(dir)).digests
  )
  const unnamed = await unnamedCodeFiles(dir, previousLock, answer, orphaned)
  await updateSourceDir(dir, {
    write,
    remove: [
      ...orphaned,
      ...(extra.remove ?? []),
      // A record of the folder's own, from before, would shadow the workspace's.
      ...(folder ? [SOURCE_WRITTEN_FILE] : []),
    ],
  })
  if (folder) await recordFolderWrite(folder, Object.fromEntries(printed), orphaned, answer.base)
  if (unnamed.length > 0) {
    printError(
      `warning: ${unnamed.join(', ')} ${unnamed.length === 1 ? 'is' : 'are'} no longer named by ${SOURCE_ENTRY_FILE} (the printed source names no code file there, such as code now printed as stored()), so ${unnamed.length === 1 ? 'it was' : 'they were'} left on disk as written: delete ${unnamed.length === 1 ? 'it' : 'them'}, or name ${unnamed.length === 1 ? 'it' : 'them'} again with codeFile(). Never commit one that holds a credential.`
    )
  }
  return write.length
}

/**
 * The code files a write leaves on disk although the printed source no longer names them: named
 * by the entry file on disk before the write or by the previous lock, neither written nor pruned
 * now, and still present. A file the person added is never deleted, so the caller says where it
 * is instead: one that held a literal secret now printed as `stored()` must not be committed.
 */
async function unnamedCodeFiles(
  dir: string,
  previousLock: unknown,
  answer: PrintedSourceAnswer,
  pruned: readonly string[]
): Promise<string[]> {
  const entry = await readSourceText(dir, SOURCE_ENTRY_FILE)
  const named = lockCodeFiles(previousLock)
  for (const literal of entry === null ? [] : codeFileReferences(entry)) {
    const path = sourceRelativePath(literal)
    if (path !== null) named.add(path)
  }
  const kept = new Set([...Object.keys(answer.files), ...lockCodeFiles(answer.lock), ...pruned])
  const candidates = [...named].filter((path) => isCodeFilePath(path) && !kept.has(path))
  const present = await Promise.all(
    candidates.map(async (path) => (await readSourceText(dir, path)) !== null)
  )
  return candidates.filter((_, index) => present[index]).sort(compareStrings)
}
