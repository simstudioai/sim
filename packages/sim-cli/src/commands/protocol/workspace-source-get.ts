import {
  isWorkspaceKind,
  KIND_DIRS,
  parseWorkspaceBase,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { WORKSPACE_BASE_FILE, WORKSPACE_SKIPPED_FILE } from '@sim/workspace-code/layout'
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
  readSourceText,
  readWrittenDigests,
  SOURCE_WRITTEN_FILE,
  updateSourceDir,
  writtenRecord,
} from './workflow-source-layout'
import {
  assertWorkspacePaths,
  keepFile,
  managedFiles,
  skippedFile,
  WORKSPACE_TREE,
} from './workspace-source-dir'

type WorkspaceSource = GetWorkspaceSourceResponse['data']

const GET_EXIT_CODES_HELP = `
Exit codes: 0 written; 1 the command failed, or the directory holds edits no apply has saved
(SOURCE_LOCAL_EDITS: apply them, get into another directory, or pass --force); 7 the workspace
has more resources of a kind than one directory holds.`

/** `--only table,workflow` as kinds, refusing an unknown one. */
export function parseKinds(value: string | undefined): WorkspaceKind[] | undefined {
  if (value === undefined) return undefined
  const kinds = value.split(',').map((kind) => kind.trim())
  const unknown = kinds.filter((kind) => !isWorkspaceKind(kind))
  if (unknown.length > 0) {
    throw new SimApiError(
      `Unknown kind ${unknown.join(', ')}; kinds are ${Object.keys(KIND_DIRS).join(', ')}.`,
      0
    )
  }
  return kinds.filter(isWorkspaceKind)
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
 * Writes a workspace source answer into the directory in one staged update: its files, the base,
 * `.sim/skipped.json`, a marker in each read kind's folder, the SDK declarations (with
 * `workspace.d.ts` typing the tables the directory declares), the CLI's `tsconfig.json` and agent
 * guide. Files of a read kind the CLI wrote earlier that the answer no longer holds (the resource
 * is gone) are removed. Refuses, unless `force`, to replace or remove a file with edits no apply
 * has saved.
 */
async function writeWorkspaceSource(
  client: Parameters<typeof loadCatalog>[0] & Parameters<typeof loadWorkspaceTypes>[0],
  dir: string,
  source: WorkspaceSource,
  force: boolean
): Promise<{ written: number; removed: number; tsconfig: boolean }> {
  assertWorkspacePaths(Object.keys(source.files))
  const written = await readWrittenDigests(dir)
  const onDisk = await managedFiles(dir, source.kinds)
  const gone = onDisk.filter(
    (path) => !Object.hasOwn(source.files, path) && Object.hasOwn(written, path)
  )
  if (!force) {
    const touched = new Map<string, string | null>(Object.entries(source.files))
    for (const path of gone) touched.set(path, null)
    const edited = await editedFiles(dir, touched)
    if (edited.length > 0) {
      throw new SimApiError(
        `${dir} has edits no apply has saved (${edited.join(', ')}). Apply them, get into another directory, or pass --force to discard them.`,
        0,
        'SOURCE_LOCAL_EDITS'
      )
    }
  }
  const tables = Object.keys(source.files).flatMap((path) => {
    const match = /^tables\/([^/]+)\.ts$/.exec(path)
    return match ? [match[1]] : []
  })
  const [catalog, workspaceTypes] = await Promise.all([
    loadCatalog(client, { workspaceId: source.workspaceId, blockTypes: [] }),
    loadWorkspaceTypes(client, source.workspaceId, { tableDeclarations: tables }),
  ])
  assertSdkMajor(catalog)
  const tree = await sourceTreeChange(dir, catalog, workspaceTypes, WORKSPACE_TREE)
  const kept = Object.fromEntries(
    Object.entries(written).filter(
      ([path]) => !gone.includes(path) && !Object.hasOwn(source.files, path)
    )
  )
  const skipped = skippedFile(source.skipped)
  const base = await mergedBase(dir, source)
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
    remove: [...gone, ...(skipped ? [] : [WORKSPACE_SKIPPED_FILE]), ...(tree.change.remove ?? [])],
  })
  const summary = finishTree(dir, write.length, workspaceTypes, tree.ownsTsconfig)
  return { written: summary.written, removed: gone.length, tsconfig: summary.tsconfig }
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
  ])
  command
    .requiredOption('--dir <dir>', 'Directory to write the workspace source into')
    .option('--only <kinds>', 'Read only these kinds (comma-separated: table, workflow)')
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
      })
    })
}
