import { constants } from 'node:fs'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  APPLY_ORDER,
  isWorkspaceKind,
  KIND_DIRS,
  parseWorkspaceBase,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { isBlobPath, WORKSPACE_BASE_FILE, WORKSPACE_SKIPPED_FILE } from '@sim/workspace-code/layout'
import type { Command } from 'commander'
import type { GetWorkspaceSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand } from '../../runtime/called-operations'
import { printProtocolResult } from './result'
import {
  assertSdkMajor,
  finishTree,
  loadCatalog,
  loadWorkspaceTypes,
  sourceTreeChange,
} from './workflow-source-get'
import {
  editedFiles,
  inBatches,
  readSourceText,
  readWrittenDigests,
  SOURCE_WRITTEN_FILE,
  updateSourceDir,
  writtenRecord,
} from './workflow-source-layout'
import {
  assertListedBlobs,
  blobDigest,
  downloadBlob,
  editedBlobs,
  recordHashedBlobs,
} from './workspace-source-blobs'
import {
  assertWorkspacePaths,
  keepFile,
  localDeclarations,
  managedFiles,
  skippedFile,
  WORKSPACE_TREE,
} from './workspace-source-dir'

type WorkspaceSource = GetWorkspaceSourceResponse['data']

const GET_EXIT_CODES_HELP = `
Exit codes: 0 written; 1 the command failed, the directory holds edits no apply has saved
(SOURCE_LOCAL_EDITS: apply them, get into another directory, or pass --force), or a downloaded
binary file does not match its listing (SOURCE_BLOB_MISMATCH: nothing was written); 7 the workspace
has more resources of a kind than one directory holds.`

/** The kind each folder holds: `--only` takes the folder a user sees as well as the kind id. */
const KIND_BY_FOLDER = new Map<string, WorkspaceKind>(
  APPLY_ORDER.map((kind) => [KIND_DIRS[kind], kind])
)

/** `--only`'s help: every kind by its folder. */
export const ONLY_KINDS_HELP = `comma-separated folders: ${APPLY_ORDER.map((kind) => KIND_DIRS[kind]).join(', ')}`

/** `--only tables,workflows` (folders) or `--only table,workflow` (kinds) as kinds. */
export function parseKinds(value: string | undefined): WorkspaceKind[] | undefined {
  if (value === undefined) return undefined
  const names = value.split(',').map((name) => name.trim())
  const kinds = names.map((name) => (isWorkspaceKind(name) ? name : KIND_BY_FOLDER.get(name)))
  const unknown = names.filter((_, index) => kinds[index] === undefined)
  if (unknown.length > 0) {
    throw new SimApiError(
      `Unknown kind ${unknown.join(', ')}; name a folder (${[...KIND_BY_FOLDER.keys()].join(', ')}) or a kind (${APPLY_ORDER.join(', ')}).`,
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
  let existing: unknown
  try {
    existing = text === null ? null : JSON.parse(text)
  } catch {
    return source.base
  }
  const current = parseWorkspaceBase(existing)
  if (!current.base || current.base.workspaceId !== source.workspaceId) return source.base
  const read = new Set<string>(source.kinds)
  const kept = Object.entries(current.base.resources).filter(
    ([address]) => !read.has(address.slice(0, address.indexOf(':')))
  )
  return { ...source.base, resources: { ...Object.fromEntries(kept), ...source.base.resources } }
}

/**
 * Writes a workspace source answer into the directory in one staged update: its files, its binary
 * files (downloaded and checked against their listed size and SHA-256 before anything moves into
 * place; one already on disk with that hash is kept), the base,
 * `.sim/skipped.json`, a marker in each read kind's folder, the SDK declarations (with
 * `workspace.d.ts` typing the resources the directory declares), the CLI's `tsconfig.json` and agent
 * guide. Files of a read kind the CLI wrote earlier that the answer no longer holds (the resource
 * is gone) are removed. Refuses, unless `force`, to replace or remove a file with edits no apply
 * has saved.
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
  const written = await readWrittenDigests(dir)
  const onDisk = await managedFiles(dir, source.kinds)
  const gone = onDisk.filter(
    (path) => !Object.hasOwn(source.files, path) && !blobs.has(path) && Object.hasOwn(written, path)
  )
  const stale = await inBatches([...blobs.values()], async (blob) =>
    blob.sha256 !== undefined && (await blobDigest(dir, blob.path)) === blob.sha256 ? null : blob
  )
  if (!force) {
    const touched = new Map<string, string | null>(Object.entries(source.files))
    const touchedBlobs = new Map<string, string | null>(
      source.blobs.map((blob) => [blob.path, blob.sha256 ?? null])
    )
    for (const path of gone) (isBlobPath(path) ? touchedBlobs : touched).set(path, null)
    const edited = [...(await editedFiles(dir, touched)), ...(await editedBlobs(dir, touchedBlobs))]
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
  /**
   * Blobs listed without a hash are downloaded (and hashed) before anything moves into place, so
   * the base and `.sim/written.json` can record their hashes.
   */
  const scratch = await mkdtemp(join(tmpdir(), 'sim-workspace-blobs-'))
  try {
    const hashless = stale.filter((blob) => blob !== null && blob.sha256 === undefined)
    const digests = new Map<string, string>()
    const scratchFile = new Map<string, string>()
    await inBatches(
      hashless.map((blob, index) => [blob, join(scratch, String(index))] as const),
      async ([blob, file]) => {
        if (!blob) return
        digests.set(blob.path, await downloadBlob(client, blob, file))
        scratchFile.set(blob.path, file)
      }
    )
    const kept = {
      ...Object.fromEntries(
        Object.entries(written).filter(
          ([path]) => !gone.includes(path) && !Object.hasOwn(source.files, path)
        )
      ),
      ...Object.fromEntries(
        source.blobs.map((blob) => [blob.path, blob.sha256 ?? digests.get(blob.path) ?? ''])
      ),
    }
    const skipped = skippedFile(source.skipped)
    const base = await mergedBase(dir, { ...source, base: recordHashedBlobs(source, digests) })
    const write: Array<readonly [string, string]> = [
      ...Object.entries(source.files),
      ...source.kinds.map((kind) => [keepFile(kind), ''] as const),
      [WORKSPACE_BASE_FILE, `${JSON.stringify(base, null, 2)}\n`],
      [SOURCE_WRITTEN_FILE, writtenRecord(source.files, kept)],
      ...(skipped ? [[WORKSPACE_SKIPPED_FILE, skipped] as const] : []),
      ...tree.change.write,
    ]
    await updateSourceDir(dir, {
      write,
      fetch: stale.flatMap((blob) => {
        if (!blob) return []
        const fetched = scratchFile.get(blob.path)
        return [
          [
            blob.path,
            (file: string) =>
              fetched
                ? copyFile(fetched, file, constants.COPYFILE_EXCL)
                : downloadBlob(client, blob, file).then(() => undefined),
          ] as const,
        ]
      }),
      remove: [
        ...gone,
        ...(skipped ? [] : [WORKSPACE_SKIPPED_FILE]),
        ...(tree.change.remove ?? []),
      ],
    })
    const downloaded = stale.filter((blob) => blob !== null).length
    const summary = finishTree(dir, write.length + downloaded, workspaceTypes, tree.ownsTsconfig)
    return { written: summary.files, removed: gone.length, guide: summary.guide }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/**
 * `sim workspaces source get --dir <dir> [--only kinds]`: writes the workspace as a source
 * directory: `tables/<key>.ts`, `workflows/<key>/` (each a workflow source directory), the base,
 * and the SDK declarations once at the root, so `workspaces source apply` can write it back.
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
    .description('Write a workspace as a source directory of tables and workflows')
    .addHelpText('after', GET_EXIT_CODES_HELP)
    .action(async (options: { dir: string; only?: string; force?: boolean }) => {
      const kinds = parseKinds(options.only)
      const { client, profile } = connect()
      const workspaceId = client.requireWorkspace()
      const { data } = await client.request<GetWorkspaceSourceResponse>('getWorkspaceSource', {
        params: { workspaceId },
        ...(kinds ? { query: { kinds: kinds.join(',') } } : {}),
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
