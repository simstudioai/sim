/**
 * The workspace source directory `workspaces source get --dir` writes and `workspaces source
 * apply --dir` reads back: one folder per kind (`tables/`, `workflows/<key>/`, …), the base in
 * `.sim/base.json`, and the SDK declarations once at the root. Path safety, staged writes and the
 * `.sim/written.json` record are the workflow source directory's (`workflow-source-layout.ts`).
 */
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { WORKSPACE_SDK_DTS } from '@sim/workflow-sdk/codegen'
import { APPLY_ORDER, type BlobEntry, KIND_DIRS, type WorkspaceKind } from '@sim/workspace-code'
import {
  isBlobPath,
  isWorkspaceSourcePath,
  WORKFLOW_BASE_FILE,
  WORKSPACE_BASE_FILE,
} from '@sim/workspace-code/layout'
import type { ApplyWorkspaceSourceBody } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { type SourceTreeProfile, TSCONFIG_MARKER } from './workflow-source-get'
import {
  digest,
  inBatches,
  listSourceFiles,
  readSourceText,
  readWrittenDigests,
  SOURCE_SDK_DIR,
} from './workflow-source-layout'

/** Where the workspace declaration SDK is written: `@sim/workflow-sdk/workspace` resolves here. */
const WORKSPACE_SDK_DIR = `${SOURCE_SDK_DIR}/workspace`
/** An empty kind folder still manages its kind, so a get keeps one with this marker. */
const KEEP_FILE = '.gitkeep'

const TSCONFIG = `${TSCONFIG_MARKER}\n${JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      moduleDetection: 'force',
      types: [],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      paths: {
        '@sim/workflow-sdk': [`./${SOURCE_SDK_DIR}/core.d.ts`],
        '@sim/workflow-sdk/workspace': [`./${WORKSPACE_SDK_DIR}/index.d.ts`],
      },
    },
    include: [
      `${KIND_DIRS.table}/*.ts`,
      `${KIND_DIRS['custom-tool']}/*.ts`,
      `${KIND_DIRS['knowledge-base']}/*/knowledge.ts`,
      `${KIND_DIRS.workflow}/*/${SOURCE_ENTRY_FILE}`,
      `${SOURCE_SDK_DIR}/**/*.d.ts`,
    ],
  },
  null,
  2
)}\n`

const AGENTS_GUIDE = `# Sim workspace source

This directory is a Sim workspace written as files. The server reads every file statically; nothing in it runs. The workspace id is \`workspaceId\` in \`${WORKSPACE_BASE_FILE}\`.

## Layout

- \`tables/<key>.ts\`: one table each: \`export default defineTable({ name, description?, folder?, columns: { … } })\` with \`column.string()\`, \`column.number()\`, \`column.select({ options: [...] })\`, … from \`@sim/workflow-sdk/workspace\`. Rows are never part of source.
- \`workflows/<key>/\`: one workflow each, exactly a \`sim workflows source get --dir\` directory (\`workflow.ts\`, \`functions/*\`, \`.sim/lock.json\`, \`.sim/base.json\`). A workflow names a table by its key: \`table('leads')\`, typed from \`tables/leads.ts\` before any apply creates it.
- A kind is managed only when its folder exists. Within it, every resource the server holds that the directory does not declare is reported, and deleted only with \`--allow-delete\`.

## Edit loop (run from this directory)

1. Edit the files. \`bunx tsc -p .\` type-checks them.
2. \`sim workspaces source apply --dir . --dry-run\`: shows the plan and every error; fix and rerun until it exits 0.
3. \`sim workspaces source apply --dir . --yes\`: writes it, tables before the workflows that use them, and rewrites this directory from what was stored.

A column's object key stays bound to its stored column: to rename a column keep the key and set \`name\` (\`email: column.string({ name: 'email_address' })\`). Changing the key drops the column and its cells.

## Exit codes

0 applied; 1 errors (each printed as file:line:column with a hint); 5 a resource changed on the server since this directory was read (get it again into a fresh directory, reapply the edit); 6 locked; 7 too large; 8 stopped part-way (what was written is saved here; apply again to continue).

Keep \`${WORKSPACE_BASE_FILE}\` and each workflow's \`.sim/\` files as written.
`

/** The workspace directory's tree beside the printed source. */
export const WORKSPACE_TREE: SourceTreeProfile = {
  agents: AGENTS_GUIDE,
  tsconfig: TSCONFIG,
  gitattributes: ['*.ts text eol=lf', '*.js text eol=lf', '*.md text eol=lf', '*.json text eol=lf'],
  sdk: Object.entries(WORKSPACE_SDK_DTS).map(
    ([name, text]) => [`${WORKSPACE_SDK_DIR}/${name}`, text] as const
  ),
}

/** Refuses a server answer naming a path outside every kind folder, before anything is written. */
export function assertWorkspacePaths(paths: Iterable<string>): void {
  for (const path of paths) {
    if (!isWorkspaceSourcePath(path)) {
      throw new SimApiError(`The workspace source named an unsafe file path: ${path}`, 0)
    }
  }
}

/** The kinds whose folder the directory holds. */
async function presentKinds(dir: string): Promise<WorkspaceKind[]> {
  const present: WorkspaceKind[] = []
  for (const kind of APPLY_ORDER) {
    const keep = await readSourceText(dir, `${KIND_DIRS[kind]}/${KEEP_FILE}`)
    const files = await listSourceFiles(dir, KIND_DIRS[kind])
    if (keep !== null || files.length > 0) present.push(kind)
  }
  return present
}

/** Every source file of the managed kinds on disk: what a get may replace or prune. */
export async function managedFiles(
  dir: string,
  kinds: readonly WorkspaceKind[]
): Promise<string[]> {
  const paths: string[] = []
  for (const kind of kinds) {
    for (const path of await listSourceFiles(dir, KIND_DIRS[kind])) {
      if (isWorkspaceSourcePath(path)) paths.push(path)
    }
  }
  return paths
}

/** A kind folder's marker, so an emptied folder keeps managing its kind. */
export function keepFile(kind: WorkspaceKind): string {
  return `${KIND_DIRS[kind]}/${KEEP_FILE}`
}

/** What one apply round sends, read from the directory. */
export interface WorkspaceSubmission {
  kinds: WorkspaceKind[]
  files: Record<string, string>
  blobs: BlobEntry[]
  base?: ApplyWorkspaceSourceBody['base']
}

function workflowFolderOf(path: string): string | null {
  const [dirName, key] = path.split('/')
  return dirName === KIND_DIRS.workflow && key ? `${dirName}/${key}` : null
}

/**
 * Reads the directory for an apply. A workflow folder whose every file is as the CLI last wrote it
 * is sent with only its `.sim/base.json`: the server treats it as unchanged, so an apply sends
 * only the workflows that were edited.
 */
export async function readWorkspaceDir(
  dir: string,
  only: readonly WorkspaceKind[] | undefined
): Promise<WorkspaceSubmission> {
  const kinds = (await presentKinds(dir)).filter((kind) => !only || only.includes(kind))
  const paths = await managedFiles(dir, kinds)
  const textPaths = paths.filter((path) => !isBlobPath(path))
  const texts = await inBatches(textPaths, (path) => readSourceText(dir, path))
  const files: Record<string, string> = {}
  textPaths.forEach((path, index) => {
    const text = texts[index]
    if (text !== null) files[path] = text
  })
  const written = await readWrittenDigests(dir)
  const folders = new Map<string, string[]>()
  for (const path of Object.keys(files)) {
    const folder = workflowFolderOf(path)
    if (folder) folders.set(folder, [...(folders.get(folder) ?? []), path])
  }
  for (const [folder, folderPaths] of folders) {
    const recorded = Object.keys(written).filter((path) => path.startsWith(`${folder}/`))
    const unchanged =
      recorded.length === folderPaths.length &&
      folderPaths.every((path) => written[path] === digest(files[path]))
    if (!unchanged) continue
    for (const path of folderPaths) {
      if (path !== `${folder}/${WORKFLOW_BASE_FILE}`) delete files[path]
    }
  }
  const root = await realpath(dir)
  const blobs = await inBatches(paths.filter(isBlobPath), async (path): Promise<BlobEntry> => {
    const bytes = await readFile(join(root, path))
    return { path, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
  })
  const baseText = await readSourceText(dir, WORKSPACE_BASE_FILE)
  let base: ApplyWorkspaceSourceBody['base']
  if (baseText !== null) {
    try {
      base = JSON.parse(baseText)
    } catch {
      throw new SimApiError(`${WORKSPACE_BASE_FILE} in ${dir} is not valid JSON.`, 0)
    }
  }
  return { kinds, files, blobs, ...(base ? { base } : {}) }
}

/** A blob's bytes as base64, for the round that sends its content. */
export async function blobContent(dir: string, path: string): Promise<string> {
  const root = await realpath(dir)
  return (await readFile(join(root, path))).toString('base64')
}

/** `.sim/skipped.json`, or `null` when nothing was skipped. */
export function skippedFile(skipped: readonly unknown[]): string | null {
  return skipped.length > 0 ? `${JSON.stringify(skipped, null, 2)}\n` : null
}
