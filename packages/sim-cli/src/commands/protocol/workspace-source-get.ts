import { mkdir, mkdtemp, realpath, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { isRecordLike } from '@sim/utils/object'
import {
  APPLY_ORDER,
  isWorkspaceKind,
  KIND_DIRS,
  parseWorkspaceBase,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { isBlobPath } from '@sim/workspace-code/kinds/registry'
import {
  KIND_BY_DIR,
  WORKSPACE_BASE_FILE,
  WORKSPACE_SKIPPED_FILE,
} from '@sim/workspace-code/layout'
import type { Command } from 'commander'
import type { GetWorkspaceSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand } from '../../runtime/called-operations'
import { printProtocolResult } from './result'
import {
  editedFiles,
  FILE_CONCURRENCY,
  readSourceJson,
  readSourceText,
  readWritten,
  recordedStats,
  SOURCE_WRITTEN_FILE,
  type StatDigest,
  updateSourceDir,
  writtenFile,
  writtenRecord,
} from './source-dir'
import {
  assertSdkMajor,
  finishTree,
  loadCatalog,
  loadWorkspaceTypes,
  sourceTreeChange,
  withSourceExitCode,
} from './source-tree'
import {
  assertListedBlobs,
  blobDigests,
  downloadBlob,
  editedBlobs,
  recordHashedBlobs,
} from './workspace-source-blobs'
import {
  assertWorkspacePaths,
  keepFile,
  kindFolders,
  localDeclarations,
  skippedFile,
  WORKSPACE_TREE,
} from './workspace-source-dir'

type WorkspaceSource = GetWorkspaceSourceResponse['data']

const GET_EXIT_CODES_HELP = `
Exit codes: 0 written; 1 the command failed, the directory holds edits no apply has saved
(SOURCE_LOCAL_EDITS: apply them, get into another directory, or pass --force), or a downloaded
binary file does not match its listing (SOURCE_BLOB_MISMATCH: nothing was written); 7 the workspace
has more resources of a kind than one directory holds.`

/** `--only`'s help: every kind by its folder. */
export const ONLY_KINDS_HELP = `comma-separated folders: ${APPLY_ORDER.map((kind) => KIND_DIRS[kind]).join(', ')}`

/** `--only tables,workflows` (folders) or `--only table,workflow` (kinds) as kinds. */
export function parseKinds(value: string | undefined): WorkspaceKind[] | undefined {
  if (value === undefined) return undefined
  const names = value.split(',').map((name) => name.trim())
  const kinds = names.map((name) => (isWorkspaceKind(name) ? name : KIND_BY_DIR.get(name)))
  const unknown = names.filter((_, index) => kinds[index] === undefined)
  if (unknown.length > 0) {
    throw new SimApiError(
      `Unknown kind ${unknown.join(', ')}; name a folder (${[...KIND_BY_DIR.keys()].join(', ')}) or a kind (${APPLY_ORDER.join(', ')}).`,
      0
    )
  }
  return [...new Set(kinds.filter((kind) => kind !== undefined))]
}

/**
 * The base a get writes: the answer's, plus the directory's entries for the kinds this get did not
 * read (a `--only` get), when the directory's base is of the same workspace. Without them, a
 * later apply would find those resources unbased.
 */
async function mergedBase(dir: string, source: WorkspaceSource): Promise<WorkspaceSource['base']> {
  const text = await readSourceText(dir, WORKSPACE_BASE_FILE)
  if (text === null) return source.base
  const current = parseWorkspaceBase(text)
  if (!current.base || current.base.workspaceId !== source.workspaceId) return source.base
  const read = new Set<string>(source.kinds)
  const kept = Object.entries(current.base.resources).filter(
    ([address]) => !read.has(address.slice(0, address.indexOf(':')))
  )
  return { ...source.base, resources: { ...Object.fromEntries(kept), ...source.base.resources } }
}

/**
 * The skipped list after a get: what this get left out, beside the entries the directory's list
 * holds for the kinds it did not read (a `--only` get keeps them, as it keeps their base entries).
 */
async function mergedSkipped(
  dir: string,
  source: WorkspaceSource
): Promise<WorkspaceSource['skipped']> {
  const current = await readSourceJson(dir, WORKSPACE_SKIPPED_FILE)
  const read = new Set<string>(source.kinds)
  const kept = Array.isArray(current)
    ? current.filter(
        (entry): entry is WorkspaceSource['skipped'][number] =>
          isRecordLike(entry) &&
          typeof entry.kind === 'string' &&
          isWorkspaceKind(entry.kind) &&
          !read.has(entry.kind) &&
          typeof entry.key === 'string' &&
          typeof entry.reason === 'string'
      )
    : []
  return [...kept, ...source.skipped]
}

/**
 * Writes a workspace source answer into the directory in one staged update: its files, its binary
 * files (downloaded and checked against their listed size and SHA-256 before anything moves into
 * place; one already on disk with that hash is kept), the base, `.sim/skipped.json`, a marker
 * in each read kind's folder, the SDK declarations (with `workspace.d.ts` typing the resources
 * the directory declares), the CLI's `tsconfig.json` and agent guide. Files of a read kind the
 * CLI wrote earlier that the answer no longer holds (the resource is gone) are removed. Refuses,
 * unless `force`, to replace or remove a file with edits no apply has saved.
 */
async function writeWorkspaceSource(
  client: Parameters<typeof loadCatalog>[0] &
    Parameters<typeof loadWorkspaceTypes>[0] &
    Parameters<typeof downloadBlob>[0],
  dir: string,
  source: WorkspaceSource,
  force: boolean
): Promise<{ written: number; removed: number; guide: string }> {
  assertWorkspacePaths(Object.keys(source.files))
  assertListedBlobs(source.blobs)
  const blobs = new Map(source.blobs.map((blob) => [blob.path, blob]))
  const written = await readWritten(dir)
  const { paths: onDisk } = await kindFolders(dir, source.kinds)
  const gone = new Set(
    onDisk.filter(
      (path) =>
        !Object.hasOwn(source.files, path) &&
        !blobs.has(path) &&
        Object.hasOwn(written.digests, path)
    )
  )
  // One read of each listed or removed blob, shared by the stale and edit checks.
  const digests = await blobDigests(
    dir,
    [...blobs.keys(), ...[...gone].filter((path) => isBlobPath(path))],
    written
  )
  const stale = source.blobs.filter(
    (blob) => blob.sha256 === undefined || digests.get(blob.path)?.sha256 !== blob.sha256
  )
  if (!force) {
    const touched = new Map<string, string | null>(Object.entries(source.files))
    const touchedBlobs = new Map<string, string | null>(
      source.blobs.map((blob) => [blob.path, blob.sha256 ?? null])
    )
    for (const path of gone) (isBlobPath(path) ? touchedBlobs : touched).set(path, null)
    const edited = [
      ...(await editedFiles(dir, touched, written.digests)),
      ...editedBlobs(touchedBlobs, digests, written.digests),
    ]
    if (edited.length > 0) {
      throw new SimApiError(
        `${dir} has edits no apply has saved (${edited.join(', ')}). Apply them, get into another directory, or pass --force to discard them.`,
        0,
        'SOURCE_LOCAL_EDITS'
      )
    }
  }
  const [catalog, workspaceTypes] = await Promise.all([
    loadCatalog(client, { workspaceId: source.workspaceId, blockTypes: [] }),
    loadWorkspaceTypes(client, source.workspaceId, localDeclarations(Object.keys(source.files))),
  ])
  assertSdkMajor(catalog)
  const tree = await sourceTreeChange(dir, catalog, workspaceTypes, WORKSPACE_TREE)
  // Stale blobs download (and hash) before anything moves into place, so the base can record the
  // hash of one listed without it and `.sim/written.json` the stat of each; they land inside the
  // directory so each moves into place by a rename, which keeps that stat.
  const scratch = stale.length > 0 ? await downloadDir(dir) : null
  try {
    const downloaded = new Map<string, StatDigest & { file: string }>()
    if (scratch) {
      await mapWithConcurrency(
        stale.map((blob, index) => [blob, join(scratch, String(index))] as const),
        FILE_CONCURRENCY,
        async ([blob, file]) => {
          const sha256 = await downloadBlob(client, blob, file)
          const { size, mtimeMs } = await stat(file)
          downloaded.set(blob.path, { sha256, size, mtimeMs, file })
        }
      )
    }
    const hashed = new Map(
      stale.flatMap((blob) => {
        const sha256 = downloaded.get(blob.path)?.sha256
        return blob.sha256 === undefined && sha256 ? [[blob.path, sha256] as const] : []
      })
    )
    const kept = {
      ...Object.fromEntries(
        Object.entries(written.digests).filter(
          ([path]) => !gone.has(path) && !Object.hasOwn(source.files, path)
        )
      ),
      ...Object.fromEntries(
        source.blobs.map((blob) => [
          blob.path,
          blob.sha256 ?? downloaded.get(blob.path)?.sha256 ?? '',
        ])
      ),
    }
    const record = writtenRecord(
      source.files,
      kept,
      new Map([...recordedStats(written), ...digests, ...downloaded])
    )
    const skipped = skippedFile(await mergedSkipped(dir, source))
    const base = await mergedBase(dir, { ...source, base: recordHashedBlobs(source, hashed) })
    const write: Array<readonly [string, string]> = [
      ...Object.entries(source.files),
      ...source.kinds.map((kind) => [keepFile(kind), ''] as const),
      [WORKSPACE_BASE_FILE, `${JSON.stringify(base, null, 2)}\n`],
      [SOURCE_WRITTEN_FILE, writtenFile(record)],
      ...(skipped ? [[WORKSPACE_SKIPPED_FILE, skipped] as const] : []),
      ...tree.change.write,
    ]
    await updateSourceDir(dir, {
      write,
      fetch: [...downloaded].map(
        ([path, { file }]) => [path, (staged: string) => rename(file, staged)] as const
      ),
      remove: [
        ...gone,
        ...(skipped ? [] : [WORKSPACE_SKIPPED_FILE]),
        ...(tree.change.remove ?? []),
      ],
    })
    const summary = finishTree(dir, write.length + stale.length, workspaceTypes, tree.ownsTsconfig)
    return { written: summary.files, removed: gone.size, guide: summary.guide }
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true })
  }
}

/** A scratch folder inside the directory, on the file system its staged write renames from. */
async function downloadDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  return mkdtemp(join(await realpath(dir), '.sim-download-'))
}

/**
 * `sim workspaces source get --dir <dir> [--only kinds]`: writes the workspace as a source
 * directory: `tables/`, `tools/`, `skills/`, `knowledge/`, `files/` and `workflows/<key>/` (each a
 * workflow source directory), the base, and the SDK declarations once at the root, so
 * `workspaces source apply` can write it back.
 */
export function attachWorkspaceSourceGet(source: Command): void {
  const [command, connect] = apiCommand(source, 'get', [
    'getWorkspaceSource',
    'getSourceCatalog',
    'getSourceResources',
    'downloadFile',
    'downloadKnowledgeDocument',
  ])
  command
    .requiredOption('--dir <dir>', 'Directory to write the workspace source into')
    .option('--only <kinds>', `Read only these kinds (${ONLY_KINDS_HELP})`)
    .option('--force', 'Replace files with edits no apply has saved')
    .allowExcessArguments(false)
    .description('Write a workspace as a source directory')
    .addHelpText('after', GET_EXIT_CODES_HELP)
    .action(async (options: { dir: string; only?: string; force?: boolean }) => {
      const kinds = parseKinds(options.only)
      const { client, profile } = connect()
      const workspaceId = client.requireWorkspace()
      const { data } = await client
        .request<GetWorkspaceSourceResponse>('getWorkspaceSource', {
          params: { workspaceId },
          ...(kinds ? { query: { kinds: kinds.join(',') } } : {}),
        })
        .catch((error: unknown) => {
          throw withSourceExitCode(error)
        })
      const result = await writeWorkspaceSource(client, options.dir, data, options.force === true)
      printProtocolResult(profile.output, {
        workspaceId: data.workspaceId,
        dir: options.dir,
        kinds: data.kinds,
        resources: Object.keys(data.base.resources).length,
        files: result.written,
        removed: result.removed,
        skipped: data.skipped.length,
        guide: result.guide,
      })
    })
}
