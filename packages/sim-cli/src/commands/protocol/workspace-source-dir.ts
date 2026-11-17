/**
 * The workspace source directory `workspaces source get --dir` writes and `workspaces source
 * apply --dir` reads back: one folder per kind (`tables/`, `workflows/<key>/`, …), the base in
 * `.sim/base.json`, and the SDK declarations once at the root. Path safety, staged writes and the
 * `.sim/written.json` record are the workflow source directory's (`workflow-source-layout.ts`).
 */
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { WORKSPACE_COOKBOOK, WORKSPACE_SDK_DTS } from '@sim/workflow-sdk/codegen'
import { APPLY_ORDER, type BlobEntry, KIND_DIRS, type WorkspaceKind } from '@sim/workspace-code'
import { groupByFile, groupByFolder } from '@sim/workspace-code/kinds/group'
import {
  isBlobPath,
  isWorkspaceSourcePath,
  kindOfPath,
  WORKFLOW_BASE_FILE,
  WORKSPACE_BASE_FILE,
} from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { SOURCE_TOO_LARGE_EXIT_CODE } from '../../exit-codes'
import type { ApplyWorkspaceSourceBody } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import {
  type LocalDeclarations,
  type SourceTreeProfile,
  TSCONFIG_MARKER,
} from './workflow-source-get'
import {
  checkedPath,
  digest,
  inBatches,
  listSourceFiles,
  readSourceText,
  readWrittenDigests,
  SOURCE_SDK_DIR,
} from './workflow-source-layout'
import { hashFile } from './workspace-source-blobs'

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

/** Where the workspace example is written: `.sim/examples/workspace/<path>`. */
const WORKSPACE_EXAMPLES_DIR = '.sim/examples/workspace'

const AGENTS_GUIDE = `# Sim workspace source

This directory is a Sim workspace written as files. The server reads every file statically; nothing in it runs. The workspace id is \`workspaceId\` in \`${WORKSPACE_BASE_FILE}\`. \`${WORKSPACE_EXAMPLES_DIR}/\` holds one correct example of each kind and a workflow using them: copy from it.

## Layout

A resource's key is its file or folder name, and a workflow names it by that key.

- \`tables/<key>.ts\`: \`export default defineTable({ name, description?, folder?, columns: { … } })\` with \`column.string()\`, \`column.number()\`, \`column.select({ options: [...] })\`, … from \`@sim/workflow-sdk/workspace\`. Rows are never part of source. A workflow: \`table('<key>')\`.
- \`knowledge/<key>/knowledge.ts\` (\`defineKnowledgeBase({ name, description?, folder?, chunking?, embeddingModel? })\`) and \`knowledge/<key>/docs/\`, one file per document, flat. A workflow: \`knowledgeBase('<key>')\`. Connector-synced documents are never part of source.
- \`files/<path>\`: every file is one workspace file at that folder path; no declaration.
- \`tools/<key>.ts\` (\`defineTool({ title, schema, code: codeFile('./<key>.js') })\`) and its code in \`tools/<key>.js\`, where each schema parameter is a variable. A workflow: \`customTool('<key>')\`.
- \`skills/<key>.md\`: a frontmatter block of \`name\` and \`description\`, then the content. A workflow: \`skills: [skill('<key>')]\` on an agent.
- \`workflows/<key>/\`: one workflow each, exactly a \`sim workflows source get --dir\` directory (\`workflow.ts\`, \`functions/*\`, \`.sim/lock.json\`, \`.sim/base.json\`).

One apply creates resources before the workflows that use them, so a workflow may name a key this directory declares before it exists. \`.sim/sdk/workspace.d.ts\` types the keys the server held and this directory declared at the last get, so \`tsc\` flags a key added since then until it is applied and read again (\`sim workspaces source get --dir .\`); the dry run is the authority for it.

Secrets never appear in source: a workflow reads an environment variable as \`env.NAME\` and tool code as \`$env.NAME\`, both by name, and a saved credential is \`credential('<key>')\`.

## Edit loop (run from this directory)

1. Edit the files. \`bunx tsc -p .\` type-checks them.
2. \`sim workspaces source apply --dir . --dry-run\`: shows the plan (\`+\` create, \`~\` update, \`=\` adopt an existing resource of the same name, \`-\` delete) and every error; fix and rerun until it exits 0.
3. \`sim workspaces source apply --dir . --yes\`: writes it and rewrites this directory from what was stored.

## Deletes

- A kind is managed only when its folder exists: without \`skills/\`, no skill is touched.
- A resource this directory managed (its key is in \`${WORKSPACE_BASE_FILE}\`) whose file is removed is deleted only with \`--allow-delete\`; without it the apply refuses. The same flag covers a removed table column, a removed knowledge base document and a removed workspace file.
- A resource the server holds that this directory never managed is kept, and named in a warning.
- Nothing deleted on the server comes back: an unchanged directory leaves it deleted, and an edit of it is refused as stale.
- Renaming a workflow folder renames the key, not a delete. A resource a workflow still uses cannot be deleted.

## Good to know

- A column's object key stays bound to its stored column: to rename one keep the key and set \`name\` (\`email: column.string({ name: 'email_address' })\`). Changing the key drops the column and its cells.
- Renaming a skill (its \`name\`) does not rewrite the workflows that use it: each agent keeps the name it stored until its \`skills\` list is next edited. The key is what binds them.
- A knowledge base's \`embeddingModel\` is fixed when it is created: an apply that changes it is refused.
- A document or workspace file over 10 MB, or whose name no directory can hold, is left out of a get and listed in \`.sim/skipped.json\`; an apply never writes or deletes it.
- A hidden file (a name starting with a dot) under a kind folder is never sent: an apply names it in a warning.

## Exit codes

0 applied; 1 errors (each printed as file:line:column with a hint); 5 a resource changed on the server since this directory was read (get it again into a fresh directory, reapply the edit); 6 locked; 7 too large; 8 stopped part-way: what was written is saved here, so apply again, as often as it takes, until it exits 0.

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
  examples: Object.entries(WORKSPACE_COOKBOOK).map(
    ([path, text]) => [`${WORKSPACE_EXAMPLES_DIR}/${path}`, text] as const
  ),
}

/**
 * The keys a directory's files declare, by kind: `tables/<key>.ts`, `knowledge/<key>/knowledge.ts`,
 * `skills/<key>.md` and `tools/<key>.ts`. `workspace.d.ts` types them beside the stored resources.
 */
export function localDeclarations(paths: readonly string[]): LocalDeclarations {
  const under = (dir: string, suffix = '') =>
    paths.filter((path) => path.startsWith(`${dir}/`) && path.endsWith(suffix))
  const byFile = (dir: string, extension: string) => [
    ...groupByFile(dir, extension, under(dir)).groups.keys(),
  ]
  const knowledgeDir = KIND_DIRS['knowledge-base']
  return {
    tableDeclarations: byFile(KIND_DIRS.table, '.ts'),
    knowledgeBases: [
      ...groupByFolder(knowledgeDir, under(knowledgeDir, '/knowledge.ts')).groups.keys(),
    ],
    skills: byFile(KIND_DIRS.skill, '.md'),
    customTools: byFile(KIND_DIRS['custom-tool'], '.ts'),
  }
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

/**
 * The files under the managed kinds' folders: `paths`, the source files, and `ignored`, the rest
 * (a hidden name, or a character no workspace path holds), which are never sent. The `.gitkeep`
 * marker is neither.
 */
async function kindFolderFiles(
  dir: string,
  kinds: readonly WorkspaceKind[]
): Promise<{ paths: string[]; ignored: string[] }> {
  const paths: string[] = []
  const ignored: string[] = []
  for (const kind of kinds) {
    for (const path of await listSourceFiles(dir, KIND_DIRS[kind])) {
      if (isWorkspaceSourcePath(path)) paths.push(path)
      else if (path.split('/').at(-1) !== KEEP_FILE) ignored.push(path)
    }
  }
  return { paths, ignored }
}

/** Every source file of the managed kinds on disk: what a get may replace or prune. */
export async function managedFiles(
  dir: string,
  kinds: readonly WorkspaceKind[]
): Promise<string[]> {
  return (await kindFolderFiles(dir, kinds)).paths
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
  /** Files under a kind folder that are not sent: hidden names and unsupported characters. */
  ignored: string[]
}

/**
 * Reads the directory for an apply. A workflow folder whose every file is as the CLI last wrote it
 * is sent with only its `.sim/base.json`: the server treats it as unchanged, so an apply sends
 * only the workflows that were edited. Blobs are hashed as streams, and one over the size limit
 * is refused (exit 7) before it is read; a blob `known` already lists (an earlier round of the
 * same apply hashed it) is not read again.
 */
export async function readWorkspaceDir(
  dir: string,
  only: readonly WorkspaceKind[] | undefined,
  known: readonly BlobEntry[] = []
): Promise<WorkspaceSubmission> {
  const kinds = (await presentKinds(dir)).filter((kind) => !only || only.includes(kind))
  const { paths, ignored } = await kindFolderFiles(dir, kinds)
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
    if (kindOfPath(path) !== 'workflow') continue
    const folder = path.split('/', 2).join('/')
    folders.set(folder, [...(folders.get(folder) ?? []), path])
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
  const verified = new Set<string>()
  const hashed = new Map(known.map((blob) => [blob.path, blob]))
  const blobs = await inBatches(paths.filter(isBlobPath), async (path): Promise<BlobEntry> => {
    const listed = hashed.get(path)
    if (listed) return listed
    const file = await checkedPath(root, path, verified)
    const { size } = await stat(file)
    if (size > WORKSPACE_SOURCE_LIMITS.maxBlobBytes) {
      throw new SimApiError(
        `${path} is ${size} bytes, over the ${WORKSPACE_SOURCE_LIMITS.maxBlobBytes}-byte limit.`,
        0,
        'SOURCE_TOO_LARGE',
        undefined,
        SOURCE_TOO_LARGE_EXIT_CODE
      )
    }
    return { path, ...(await hashFile(file)) }
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
  return { kinds, files, blobs, ignored, ...(base ? { base } : {}) }
}

/**
 * A blob as the round that sends its content carries it: its bytes as base64, with the SHA-256
 * and size of those same bytes, read once.
 */
export async function blobContent(
  dir: string,
  path: string
): Promise<BlobEntry & { content: string }> {
  const bytes = await readFile(await checkedPath(await realpath(dir), path, new Set()))
  return {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    content: bytes.toString('base64'),
  }
}

/** `.sim/skipped.json`, or `null` when nothing was skipped. */
export function skippedFile(skipped: readonly unknown[]): string | null {
  return skipped.length > 0 ? `${JSON.stringify(skipped, null, 2)}\n` : null
}
