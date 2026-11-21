import { mkdir, mkdtemp, realpath, rename, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { isWorkspaceKind, parseWorkspaceBase } from '@sim/workspace-code'
import { isBlobPath } from '@sim/workspace-code/kinds/registry'
import { WORKSPACE_BASE_FILE, WORKSPACE_SKIPPED_FILE } from '@sim/workspace-code/layout'
import type { Command } from 'commander'
import { printError } from '#sim-cli/output/io'
import type { GetWorkspaceSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand } from '../../runtime/called-operations'
import { searchTasks } from '../search'
import { removeStagingOnSignal } from './files-get'
import { SourceDirError } from './local-errors'
import {
  absoluteDirOption,
  assertSourceDirKind,
  checkedPath,
  directoryWorkspace,
  editedFiles,
  FILE_CONCURRENCY,
  readSourceJson,
  readSourceText,
  readWritten,
  recordedStats,
  SOURCE_DOWNLOADS_DIR,
  updateSourceDir,
  withSourceDirLock,
  writtenFiles,
  writtenRecord,
} from './source-dir'
import { sourceExitCodesHelp } from './source-exit-codes'
import {
  assertSdkMajor,
  finishTree,
  loadCatalog,
  loadWorkspaceTypes,
  printTreeResult,
  sourceTreeChange,
  withSourceExitCode,
} from './source-tree'
import { findingsOutput } from './source-ui'
import {
  removedWorkflowRecords,
  unrecordedFoldersWarning,
  workflowFolderRecords,
} from './stored-edges'
import {
  assertListedBlobs,
  blobDigests,
  editedBlobs,
  type FetchedBlob,
  fetchBlob,
  recordHashedBlobs,
} from './workspace-source-blobs'
import {
  assertWorkspacePaths,
  keepFile,
  kindFolders,
  localDeclarations,
  ONLY_KINDS_HELP,
  parseKinds,
  seedRowsFiles,
  skippedFile,
  WORKSPACE_TREE,
} from './workspace-source-dir'

type WorkspaceSource = GetWorkspaceSourceResponse['data']

const GET_HELP = `
A directory that already holds a .sim/base.json is refreshed from the workspace it was read from,
whatever the profile's default workspace.
${sourceExitCodesHelp('workspaces source get')}`

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
    Parameters<typeof fetchBlob>[0],
  dir: string,
  source: WorkspaceSource,
  force: boolean
): Promise<{ written: number; removed: number; guide: string; primer: string }> {
  assertWorkspacePaths(Object.keys(source.files))
  assertListedBlobs(source.blobs)
  const blobs = new Map(source.blobs.map((blob) => [blob.path, blob]))
  const written = await readWritten(dir)
  const { paths: onDisk } = await kindFolders(dir, source.kinds)
  const seedRows = seedRowsFiles(source.files)
  const gone = new Set(
    onDisk.filter(
      (path) =>
        !Object.hasOwn(source.files, path) &&
        !blobs.has(path) &&
        !seedRows.has(path) &&
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
      throw new SourceDirError(
        `${dir} has edits no apply has saved (${edited.join(', ')}). Apply them, get into another directory, or pass --force to discard them.`,
        { code: 'SOURCE_LOCAL_EDITS' }
      )
    }
  }
  const [catalog, workspaceTypes] = await Promise.all([
    loadCatalog(client, { workspaceId: source.workspaceId, blockTypes: [] }),
    loadWorkspaceTypes(client, source.workspaceId, localDeclarations(source.files)),
  ])
  assertSdkMajor(catalog)
  const { records: workflowRecords, unrecorded } = await workflowFolderRecords(
    client,
    source.workspaceId,
    catalog,
    source.files
  )
  // A get that leaves the workflows unread keeps the blocks those on disk type-check against.
  const tree = await sourceTreeChange(
    dir,
    catalog,
    workspaceTypes,
    WORKSPACE_TREE,
    {
      sources: Object.entries(source.files).flatMap(([path, text]) =>
        path.endsWith('.ts') ? [text] : []
      ),
    },
    { incremental: !source.kinds.includes('workflow') }
  )
  // Stale blobs download (and hash) before anything moves into place, so the base can record the
  // hash of one listed without it; they land inside the directory so each moves into place by a
  // rename.
  const downloads = await checkedPath(await downloadsRoot(dir), SOURCE_DOWNLOADS_DIR, new Set())
  const downloaded = new Map<string, FetchedBlob>()
  // This get's partial downloads, removed on every way out, an interrupt included; a verified
  // download kept for the next get sits beside it in `downloads`.
  let partial: string | null = null
  const disposeSignalCleanup = removeStagingOnSignal(() => partial)
  try {
    if (stale.length > 0) {
      await mkdir(downloads, { recursive: true })
      const folder = await mkdtemp(join(downloads, PARTIAL_PREFIX))
      partial = folder
      try {
        await mapWithConcurrency(stale, FILE_CONCURRENCY, async (blob) => {
          downloaded.set(blob.path, await fetchBlob(client, blob, downloads, folder))
        })
      } catch (error) {
        throw await keepDownloads(error, downloads, folder, [...downloaded.values()], stale.length)
      }
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
      new Map([...recordedStats(written), ...digests])
    )
    const skipped = skippedFile(await mergedSkipped(dir, source))
    const base = await mergedBase(dir, { ...source, base: recordHashedBlobs(source, hashed) })
    const write: Array<readonly [string, string]> = [
      ...Object.entries(source.files),
      ...source.kinds.flatMap((kind) => {
        const marker = keepFile(kind)
        return marker === null ? [] : [[marker, ''] as const]
      }),
      [WORKSPACE_BASE_FILE, `${JSON.stringify(base, null, 2)}\n`],
      ...writtenFiles(record),
      ...(skipped ? [[WORKSPACE_SKIPPED_FILE, skipped] as const] : []),
      ...workflowRecords,
      ...tree.change.write,
    ]
    await updateSourceDir(dir, {
      write,
      fetch: [...downloaded].map(
        ([path, { file }]) => [path, (staged: string) => rename(file, staged)] as const
      ),
      remove: [
        ...gone,
        ...removedWorkflowRecords(gone),
        ...(skipped ? [] : [WORKSPACE_SKIPPED_FILE]),
        ...(tree.change.remove ?? []),
      ],
    })
    await rm(downloads, { recursive: true, force: true })
    const unrecordedWarning = unrecordedFoldersWarning(unrecorded)
    if (unrecordedWarning) printError(unrecordedWarning)
    const summary = finishTree(dir, write.length + stale.length, workspaceTypes, tree)
    return {
      written: summary.files,
      removed: gone.size,
      guide: summary.guide,
      primer: summary.primer,
    }
  } finally {
    if (partial) await rm(partial, { recursive: true, force: true })
    disposeSignalCleanup()
  }
}

/** The prefix of a get's own folder in the downloads folder, for the downloads no get reuses. */
const PARTIAL_PREFIX = '.partial-'

/** The directory, resolved, so the downloads folder sits on the file system its renames stay on. */
async function downloadsRoot(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  return realpath(dir)
}

/**
 * The error a get whose download failed throws, once it dropped the downloads no later get can
 * reuse: it names the blobs kept, so a rerun after a rate limit or a dropped connection resumes.
 */
async function keepDownloads(
  error: unknown,
  downloads: string,
  partial: string,
  fetched: readonly FetchedBlob[],
  listed: number
): Promise<unknown> {
  await rm(partial, { recursive: true, force: true })
  const kept = fetched.filter((blob) => blob.kept).length
  if (kept === 0) await rmdir(downloads).catch(() => {})
  if (!(error instanceof SimApiError) || kept === 0) return error
  return new SimApiError(
    `${error.message} ${kept} of ${listed} binary files were downloaded and are kept in ${SOURCE_DOWNLOADS_DIR}: run the get again to download only the rest.`,
    error.status,
    error.code,
    error.details,
    error.exitCode,
    error.requestId
  )
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
  absoluteDirOption(command)
  searchTasks(command, [
    'change the model in every agent block',
    'bulk edit every workflow in the workspace',
    'edit all workflows, tables and skills as code',
  ])
  command
    .requiredOption('--dir <dir>', 'Directory to write the workspace source into')
    .option('--only <kinds>', `Read only these kinds (${ONLY_KINDS_HELP})`)
    .option('--force', 'Replace files with edits no apply has saved')
    .allowExcessArguments(false)
    .description('Write a workspace as a source directory')
    .addHelpText('after', GET_HELP)
    .action(async (options: { dir: string; only?: string; force?: boolean }) => {
      const kinds = parseKinds(options.only)
      const { client, profile } = connect()
      await withSourceDirLock(options.dir, async () => {
        await assertSourceDirKind(options.dir, 'workspace')
        // Read as leniently as an apply reads it: a base the parser refuses still names its workspace.
        const recorded = toRecord(
          await readSourceJson(options.dir, WORKSPACE_BASE_FILE)
        ).workspaceId
        const workspaceId = client.requireWorkspace(
          directoryWorkspace(
            options.dir,
            typeof recorded === 'string' ? recorded : null,
            profile,
            (readFrom, named) =>
              `Get ${named} into another directory, or run the get without --workspace to refresh ${readFrom}; to apply this directory to ${named}, use \`sim workspaces source apply --to ${named}\`.`
          ) ?? undefined
        )
        const { data } = await client
          .request<GetWorkspaceSourceResponse>('getWorkspaceSource', {
            params: { workspaceId },
            ...(kinds ? { query: { kinds: kinds.join(',') } } : {}),
          })
          .catch((error: unknown) => {
            throw withSourceExitCode(error)
          })
        const result = await writeWorkspaceSource(client, options.dir, data, options.force === true)
        const findings = findingsOutput(profile.output, false, options.dir)
        findings.print(data.diagnostics)
        for (const { kind, key, reason } of data.skipped) {
          printError(
            `Skipped ${kind} ${key}: ${reason} It is not written here, and an apply keeps it as the server has it (${WORKSPACE_SKIPPED_FILE} lists it).`
          )
        }
        printTreeResult(profile.output, {
          workspaceId: data.workspaceId,
          dir: options.dir,
          kinds: data.kinds,
          resources: Object.keys(data.base.resources).length,
          files: result.written,
          removed: result.removed,
          skipped: data.skipped.length,
          guide: result.guide,
          primer: result.primer,
          ...findings.result(data.diagnostics),
        })
      })
    })
}
