/**
 * The workspace source directory `workspaces source get --dir` writes and `workspaces source
 * apply --dir` reads back: one folder per kind (`tables/`, `workflows/<key>/`, …), the base in
 * `.sim/base.json`, and the SDK declarations once at the root. Path safety, staged writes and the
 * `.sim/written.json` record are the source directory's (`source-dir.ts`).
 */
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { WORKSPACE_COOKBOOK, WORKSPACE_SDK_DTS } from '@sim/workflow-sdk/codegen'
import { APPLY_ORDER, type BlobEntry, KIND_DIRS, type WorkspaceKind } from '@sim/workspace-code'
import { isBlobPath, KIND_LAYOUTS } from '@sim/workspace-code/kinds/registry'
import { unchangedFiles, workflowFolder } from '@sim/workspace-code/kinds/workflow'
import { isWorkspaceSourcePath, kindOfPath, WORKSPACE_BASE_FILE } from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { SOURCE_TOO_LARGE_EXIT_CODE } from '../../exit-codes'
import type { ApplyWorkspaceSourceBody } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import {
  checkedPath,
  digest,
  FILE_CONCURRENCY,
  listSourceFiles,
  readSourceText,
  SOURCE_SDK_DIR,
  type StatDigest,
  type Written,
} from './source-dir'
import { type LocalDeclarations, type SourceTreeProfile, TSCONFIG_MARKER } from './source-tree'
import { statDigest } from './workspace-source-blobs'

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

1. Edit the files. \`bunx tsc -p .\` type-checks them, but the dry run is the authority: a printed file you did not edit that \`tsc\` flags and the dry run accepts is fine, so leave it as it is.
2. \`sim workspaces source apply --dir . --dry-run\`: shows the plan (\`+\` create, \`~\` update, \`=\` adopt an existing resource of the same name, \`-\` delete) and every error; fix and rerun until it exits 0.
3. \`sim workspaces source apply --dir . --yes\`: writes it and rewrites this directory from what was stored.

## Deletes

- A kind is managed only when its folder exists: without \`skills/\`, no skill is touched.
- A resource this directory managed (its key is in \`${WORKSPACE_BASE_FILE}\`) whose file is removed is deleted only with \`--allow-delete\`; without it the apply refuses. The same flag covers a removed table column, a removed knowledge base document and a removed workspace file.
- A resource the server holds that this directory never managed is kept, and named in a warning.
- Nothing deleted on the server comes back: an unchanged directory leaves it deleted, and an edit of it is refused as stale.
- To fork a workflow, copy its folder to a new key and delete the copy's \`.sim/\`: without it the copy is created as a new workflow, while with it the copy still names the original.
- Renaming a workflow folder renames the key, not a delete. A resource a workflow still uses cannot be deleted.

## Good to know

- A column's object key stays bound to its stored column: to rename one keep the key and set \`name\` (\`email: column.string({ name: 'email_address' })\`). Changing the key drops the column and its cells.
- Renaming a skill (its \`name\`) does not rewrite the workflows that use it: each agent keeps the name it stored until its \`skills\` list is next edited. The key is what binds them.
- A workflow folder you did not edit is sent with only its base, and the server does not compare it with the stored workflow: unlike other kinds, an apply does not report that a workflow changed on the server since the get (the next get shows it). An edit of the folder is checked against its own \`.sim/base.json\` and refused as stale (exit 5) when the workflow changed since.
- A knowledge base's \`embeddingModel\` is fixed when it is created: an apply that changes it is refused.
- A document or workspace file over 10 MB, or whose name no directory can hold, is left out of a get and listed in \`.sim/skipped.json\`; an apply never writes or deletes it.
- A hidden file (a name starting with a dot) under a kind folder is never sent: an apply names it in a warning.

## Exit codes

0 applied; 1 errors (each printed as file:line:column with a hint); 5 a resource changed on the server since this directory was read (get it again into a fresh directory, reapply the edit; right after an apply that ended without an answer, such as a timeout, that apply was written: run \`sim workspaces source get --dir . --force\`, nothing is lost); 6 locked; 7 too large; 8 stopped part-way (a resource failed, or a later round stayed rate limited): what was written is saved here, so apply again, as often as it takes, until it exits 0; 9 rate limited (HTTP 429) after the CLI's retries: nothing more was written, so wait a minute and run the same command again (a get keeps the binary files it downloaded and fetches only the rest).

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
 * The keys a directory's files declare, by kind, grouped by each kind's codec: its tables (typed
 * from their declarations), and its knowledge base, skill, custom tool and workflow keys.
 * `workspace.d.ts` types them beside the stored resources.
 */
export function localDeclarations(paths: readonly string[]): LocalDeclarations {
  const keys = (kind: WorkspaceKind) => [
    ...KIND_LAYOUTS[kind].group(paths.filter((path) => kindOfPath(path) === kind)).groups.keys(),
  ]
  return {
    tableDeclarations: keys('table'),
    knowledgeBases: keys('knowledge-base'),
    skills: keys('skill'),
    customTools: keys('custom-tool'),
    workflows: Object.fromEntries(keys('workflow').map((key) => [key, {}])),
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

/**
 * The folders of `kinds`, each walked once: `present`, the kinds whose folder holds any file (its
 * `.gitkeep` marker included); `paths`, their source files; and `ignored`, the rest (a hidden
 * name, or a character no workspace path holds), which are never sent. The marker is neither.
 */
export async function kindFolders(
  dir: string,
  kinds: readonly WorkspaceKind[]
): Promise<{ present: WorkspaceKind[]; paths: string[]; ignored: string[] }> {
  const present: WorkspaceKind[] = []
  const paths: string[] = []
  const ignored: string[] = []
  for (const kind of kinds) {
    const files = await listSourceFiles(dir, KIND_DIRS[kind])
    if (files.length > 0) present.push(kind)
    for (const path of files) {
      if (isWorkspaceSourcePath(path)) paths.push(path)
      else if (path !== keepFile(kind)) ignored.push(path)
    }
  }
  return { present, paths, ignored }
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
  /** The blobs this read hashed or reused a recorded digest for, with their stats. */
  hashed: ReadonlyMap<string, StatDigest>
}

/**
 * Reads the directory for an apply to `workspaceId`. A workflow folder whose every file is as the
 * CLI last wrote it is sent as `unchangedFiles` says (its base alone when it was read from
 * `workspaceId`), so an apply sends only the workflows that were edited, and a copy to another
 * workspace still sends every workflow it creates. `written` is `.sim/written.json` as the command
 * read it. Blobs are hashed as streams (reusing the digest `written` records for one whose size and
 * modification time are unchanged), and one over the size limit is refused (exit 7) before it is
 * read; a blob `known` already lists (an earlier round of the same apply hashed it) is not read
 * again.
 */
export async function readWorkspaceDir(
  dir: string,
  only: readonly WorkspaceKind[] | undefined,
  workspaceId: string,
  written: Written,
  known: readonly BlobEntry[] = []
): Promise<WorkspaceSubmission> {
  const {
    present: kinds,
    paths,
    ignored,
  } = await kindFolders(
    dir,
    APPLY_ORDER.filter((kind) => !only || only.includes(kind))
  )
  const textPaths = paths.filter((path) => !isBlobPath(path))
  const texts = await mapWithConcurrency(textPaths, FILE_CONCURRENCY, (path) =>
    readSourceText(dir, path)
  )
  const files: Record<string, string> = {}
  textPaths.forEach((path, index) => {
    const text = texts[index]
    if (text !== null) files[path] = text
  })
  const workflowPaths = Object.keys(files).filter((path) => kindOfPath(path) === 'workflow')
  const folders = KIND_LAYOUTS.workflow.group(workflowPaths).groups
  // Files per workflow folder that `.sim/written.json` records.
  const recorded = new Map<string, number>()
  for (const path of Object.keys(written.digests)) {
    if (kindOfPath(path) !== 'workflow') continue
    const folder = path.split('/', 2).join('/')
    recorded.set(folder, (recorded.get(folder) ?? 0) + 1)
  }
  for (const [key, folderPaths] of folders) {
    const unchanged =
      recorded.get(workflowFolder(key)) === folderPaths.length &&
      folderPaths.every((path) => written.digests[path] === digest(files[path]))
    if (!unchanged) continue
    const sent = unchangedFiles(
      key,
      Object.fromEntries(folderPaths.map((path) => [path, files[path]])),
      workspaceId
    )
    for (const path of folderPaths) if (!Object.hasOwn(sent, path)) delete files[path]
  }
  const root = await realpath(dir)
  const verified = new Set<string>()
  const listed = new Map(known.map((blob) => [blob.path, blob]))
  const hashed = new Map<string, StatDigest>()
  const blobs = await mapWithConcurrency(
    paths.filter(isBlobPath),
    FILE_CONCURRENCY,
    async (path): Promise<BlobEntry> => {
      const entry = listed.get(path)
      if (entry) return entry
      const file = await checkedPath(root, path, verified)
      const current = await stat(file)
      const { size } = current
      if (size > WORKSPACE_SOURCE_LIMITS.maxBlobBytes) {
        throw new SimApiError(
          `${path} is ${size} bytes, over the ${WORKSPACE_SOURCE_LIMITS.maxBlobBytes}-byte limit.`,
          0,
          'SOURCE_TOO_LARGE',
          undefined,
          SOURCE_TOO_LARGE_EXIT_CODE
        )
      }
      const digested = await statDigest(file, path, current, written)
      hashed.set(path, digested)
      return { path, sha256: digested.sha256, size: digested.size }
    }
  )
  const baseText = await readSourceText(dir, WORKSPACE_BASE_FILE)
  let base: ApplyWorkspaceSourceBody['base']
  if (baseText !== null) {
    try {
      base = JSON.parse(baseText)
    } catch {
      throw new SimApiError(`${WORKSPACE_BASE_FILE} in ${dir} is not valid JSON.`, 0)
    }
  }
  return { kinds, files, blobs, ignored, hashed, ...(base ? { base } : {}) }
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
