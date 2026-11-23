/**
 * The workspace source directory `workspaces source get --dir` writes and `workspaces source
 * apply --dir` reads back: one folder per kind (`tables/`, `workflows/<key>/`, …), the base in
 * `.sim/base.json`, and the SDK declarations once at the root. Path safety, staged writes and the
 * `.sim/written.json` record are the source directory's (`source-dir/`).
 */
import { realpath, stat } from 'node:fs/promises'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { compareStrings } from '@sim/utils/string'
import type { WorkflowInput } from '@sim/workflow-code'
import { SOURCE_CODE_DIR, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import {
  SOURCE_COMPILER_OPTIONS,
  typecheckCommand,
  WORKSPACE_COOKBOOK,
  WORKSPACE_SDK_DTS,
} from '@sim/workflow-sdk/codegen'
import {
  APPLY_ORDER,
  type BlobEntry,
  type FlatDiagnostic,
  isFileKind,
  isWorkspaceKind,
  KIND_DIRS,
  WORKSPACE_KIND_SPECS,
  type WorkspaceDiagnosticCode,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { fileKindGroupKey } from '@sim/workspace-code/kinds/entries'
import { FILE_KIND_CODECS, isBlobPath, KIND_LAYOUTS } from '@sim/workspace-code/kinds/registry'
import {
  columnName,
  createTableCodec,
  refusedTableRows,
  TABLE_COLUMN_METADATA_KEYS,
  type TableDecl,
} from '@sim/workspace-code/kinds/table'
import { parseTableRows, tableRowsPath } from '@sim/workspace-code/kinds/table-rows'
import { toolCodec, toolDeclarationPath } from '@sim/workspace-code/kinds/tools'
import { unchangedFiles, workflowFolder } from '@sim/workspace-code/kinds/workflow'
import {
  DECLARATION_EXTENSION,
  DECLARATION_MODULES,
  isWorkspaceSourcePath,
  KIND_BY_DIR,
  kindOfPath,
  WORKSPACE_BASE_FILE,
} from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import {
  RATE_LIMITED_EXIT_CODE,
  SOURCE_BUSY_EXIT_CODE,
  SOURCE_DRIFT_EXIT_CODE,
  SOURCE_HELD_EXIT_CODE,
  SOURCE_LOCAL_CHANGES_EXIT_CODE,
  SOURCE_PLANNED_EXIT_CODE,
  SOURCE_STALE_EXIT_CODE,
  SOURCE_TOO_LARGE_EXIT_CODE,
} from '../../exit-codes'
import type { ApplyWorkspaceSourceBody } from '../../generated/v2-api'
import { CliUsageError, SourceDirError } from './local-errors'
import {
  assertSourceDirKind,
  checkedPath,
  digest,
  FILE_CONCURRENCY,
  listSourceFiles,
  readSourceText,
  SOURCE_DIR_LOCK,
  SOURCE_DOWNLOADS_DIR,
  SOURCE_SDK_DIR,
  SOURCE_STAGING_PREFIX,
  SOURCE_STORED_EDGES_FILE,
  type StatDigest,
  type Written,
} from './source-dir'
import { sourceExitCodesTable } from './source-exit-codes'
import { STRICT_FINDINGS_CLAUSE } from './source-strict'
import {
  type LocalDeclarations,
  type SourceTreeProfile,
  TSCONFIG_FULL_FILE,
  TSCONFIG_MARKER,
} from './source-tree'
import { codeFilePaths } from './workflow-dir'
import { statDigest } from './workspace-source-blobs'

/** Where the workspace declaration SDK is written: `@sim/workflow-sdk/workspace` resolves here. */
const WORKSPACE_SDK_DIR = `${SOURCE_SDK_DIR}/workspace`
/** An empty kind folder still manages its kind, so a get keeps one with this marker. */
const KEEP_FILE = '.gitkeep'

/**
 * A `tsconfig.json` for the workspace directory: every kind's TypeScript files, checked with the
 * workspace declaration SDK and the workflow SDK files `sdkFiles`.
 */
function workspaceTsconfig(sdkFiles: readonly string[]): string {
  return `${TSCONFIG_MARKER}\n${JSON.stringify(
    {
      compilerOptions: {
        ...SOURCE_COMPILER_OPTIONS,
        skipLibCheck: true,
        paths: {
          '@sim/workflow-sdk': [`./${SOURCE_SDK_DIR}/core.d.ts`],
          '@sim/workflow-sdk/workspace': [`./${WORKSPACE_SDK_DIR}/index.d.ts`],
        },
      },
      include: [
        ...APPLY_ORDER.flatMap((kind) => WORKSPACE_KIND_SPECS[kind].typeChecked),
        `${WORKSPACE_SDK_DIR}/*.d.ts`,
        ...sdkFiles,
      ],
    },
    null,
    2
  )}\n`
}

/** Where the workspace example is written: `.sim/examples/workspace/<path>`. */
const WORKSPACE_EXAMPLES_DIR = '.sim/examples/workspace'

/** Where the workspace guide's deep dives are written, beside `.sim/AGENTS.md`. */
const WORKSPACE_ADVANCED_FILE = '.sim/GUIDE-advanced.md'

/**
 * The reference below the primer in `.sim/AGENTS.md`: the layout, the edit loop in detail, what
 * to know and every exit code.
 */
const AGENTS_GUIDE = `# Reference

The primer above is enough to edit; read a section here when a step needs it. Deletes in depth, Git and CI, and promoting to another workspace: \`${WORKSPACE_ADVANCED_FILE}\`.

\`${WORKSPACE_EXAMPLES_DIR}/\` holds one correct example of each kind and a workflow using them, and \`.sim/examples/*.ts\` one workflow example of each common block (agent with structured output, condition, HTTP request, child workflow, Slack, loop, …): copy from them. Look up any other builder with \`sim workflows source params <builder>\`.

## Layout

A resource's key is its file or folder name (in \`${KIND_DIRS.secret}\` and \`${KIND_DIRS.credential}\`, the entry's name), and a workflow names it by that key.

${APPLY_ORDER.map((kind) => `- ${WORKSPACE_KIND_SPECS[kind].guide}`).join('\n')}

One apply creates resources before the workflows that use them, so a workflow may name a key this directory declares before it exists. \`.sim/sdk/workspace.d.ts\` types the keys the server held at the last get and the ones this directory declares, with each workflow's inputs: \`sim workspaces source check\` (or \`sim workflows source check\` in a workflow folder) regenerates it from the files, so run it before \`tsc\` after adding a resource or a workflow input. The dry run is the authority.

Secrets never appear in source: a workflow reads an environment variable as \`env.NAME\` and tool code as \`$env.NAME\`, both by name, and a saved credential is \`credential('<key>')\`. Declare the ones workflows use in \`${KIND_DIRS.secret}\` and \`${KIND_DIRS.credential}\`: a workflow using a declared secret the workspace has no value for, or a declared credential key nothing binds to, is held back, with the command that fixes it, while the rest of the apply is written (exit ${SOURCE_HELD_EXIT_CODE}; exit 1 when nothing else was). The same directory applied to another workspace binds each credential key to that workspace's own credential.

## Edit loop in detail

1. Edit the files.
2. \`sim workspaces source check --dir .\`: compiles every workflow offline with the server's compiler, against what this directory declares: an unknown resource key (skills included) or table column, a child workflow's inputs, and an env name \`${KIND_DIRS.secret}\` lacks (a warning); and checks each \`${KIND_DIRS.table}/<key>.rows.jsonl\` line against its table as the apply would. It fails (exit 1) on errors and on ${STRICT_FINDINGS_CLAUSE} in a block you added (\`--strict\`: in every block), regenerates \`.sim/sdk/workspace.d.ts\` and adds the blocks the workflows now use to \`tsconfig.json\`. In a workflow folder, \`sim workflows source check --dir .\` checks that one workflow the same way. Fix and rerun until it exits 0.
3. Run \`${typecheckCommand()}\` after every edit, before any dry run or apply, and fix what it reports: it takes about a second and catches what step 2 and the dry run do not (such as a reference to a start input the trigger does not declare). It type-checks the files with the TypeScript release the declarations are built for. \`tsconfig.json\` includes only the blocks the workflows used at the last check or get, which keeps it fast: a builder from another block fails with \`has no exported member\` until you run step 2 (or check with \`${typecheckCommand(TSCONFIG_FULL_FILE)}\`, every current block). \`sim workflows source params <builder>\` prints one builder's params and outputs; do not read the declarations whole. The dry run is the authority: a printed file you did not edit that \`tsc\` flags and the dry run accepts is fine, so leave it as it is.
4. \`sim workspaces source status --dir .\` before applying: your changes by resource (\`sim workspaces source diff --dir .\` shows the edits), what changed on the server since the get (a workflow edited in the editor included), the conflicts, and the command to run next. Exit 0 nothing changed, ${SOURCE_LOCAL_CHANGES_EXIT_CODE} only your edits, ${SOURCE_DRIFT_EXIT_CODE} the server changed since (\`--offline\`: skip the server). Then \`sim workspaces source apply --dir . --dry-run\`: shows the plan (\`+\` create, \`~\` update, \`=\` adopt an existing resource of the same name, \`-\` delete) and every error; fix and rerun until it exits 0.
5. \`sim workspaces source apply --dir . --yes\`: writes it and rewrites this directory from what was stored; it prints the plan it applied (without \`--yes\` and a terminal it prints the plan and exits ${SOURCE_PLANNED_EXIT_CODE}, writing nothing).

## Good to know

- A column's object key stays bound to its stored column: to rename one keep the key and set \`name\` (\`email: column.string({ name: 'email_address' })\`). Changing the key drops the column and its cells.
- Renaming a skill (its \`name\`) does not rewrite the workflows that use it: each agent keeps the name it stored until its \`skills\` list is next edited. The key is what binds them.
- A workflow folder you did not edit is sent with only its base, and the server does not compare it with the stored workflow: unlike other kinds, an apply does not report that a workflow changed on the server since the get (\`status\`, which sends every folder whole, does, and the next get shows it). An edit of the folder is checked against its own \`.sim/base.json\` and refused as stale (exit ${SOURCE_STALE_EXIT_CODE}) when the workflow changed since.
- A knowledge base's \`embeddingModel\` is fixed when it is created: an apply that changes it is refused.
- A document or workspace file over 10 MB, or whose name no directory can hold, is left out of a get and listed in \`.sim/skipped.json\`; an apply never writes or deletes it.
- A hidden file (a name starting with a dot) under a kind folder is never sent: an apply names it in a warning.

## Exit codes

${sourceExitCodesTable('sim workspaces source')}

Exit ${SOURCE_STALE_EXIT_CODE} right after an apply that ended without an answer (a timeout, a dropped connection) means that apply or someone else changed the workspace: get into a fresh directory and compare, and only when it holds your edits run \`sim workspaces source get --dir . --force\`. A get that exits ${RATE_LIMITED_EXIT_CODE} keeps the binary files it downloaded and fetches only the rest.

Keep \`${WORKSPACE_BASE_FILE}\` and each workflow's \`.sim/\` files as written.
`

/** The workspace guide's deep dives, which `.sim/AGENTS.md` points to in one line. */
const ADVANCED_GUIDE = `# Sim workspace source: advanced

## Deletes

- A kind is managed only when its folder (or root file) exists: without \`skills/\`, no skill is touched.
- Nothing in \`${KIND_DIRS.secret}\` or \`${KIND_DIRS.credential}\` is ever deleted on the server: removing a secret changes nothing, and removing a credential key unbinds it only with \`--allow-delete\` (the credential is kept).
- A resource this directory managed (its key is in \`${WORKSPACE_BASE_FILE}\`) whose file is removed is deleted only with \`--allow-delete\`; without it the apply refuses. The same flag covers a removed table column, a removed knowledge base document, a removed workspace file and a block removed from a workflow.
- A resource the server holds that this directory never managed is kept, and named in a warning.
- Nothing deleted on the server comes back: an unchanged directory leaves it deleted, and an edit of it is refused as stale.
- To fork a workflow, copy its folder to a new key and delete the copy's \`.sim/\`: without it the copy is created as a new workflow, while with it the copy still names the original.
- Renaming a workflow folder renames the key, not a delete. A resource a workflow still uses cannot be deleted.
- A delete cannot be undone by applying an older copy of this directory (a reverted commit): the resource stays deleted, and table rows, knowledge base documents, a workflow's run history and its webhook URLs and schedules are gone. The plan marks each such change and the summary counts them (\`destructive\`); deleting a deployed workflow lists the live webhooks and schedules that stop.

## Git and CI

- Commit the whole directory, \`.sim/\` included: \`${WORKSPACE_BASE_FILE}\`, each workflow's \`.sim/\` and \`.sim/written.json\` are what a later apply compares with, from any clone. \`.sim/cache/\` holds this machine's file stats and ignores itself. The generated \`.gitignore\` leaves out only what a command keeps while it runs (\`.sim/downloads/\`, \`.sim/command.lock/\`, \`.sim-staging-*\`) and \`${TSCONFIG_FULL_FILE}\`, which names the CLI's cache on this machine (\`check\` writes it again), and \`.gitattributes\` keeps workspace files and documents byte for byte.
- A fresh clone runs \`check\` (it downloads the block catalog once when none is cached), \`apply --dry-run\` and \`apply --yes\` with only the committed files. A workspace API key may apply tables, rows, knowledge bases, files, custom tools, MCP servers and credential bindings; workflows, skills, secrets and deployments need a member's personal API key (deployments an admin's).
- Plan on every pull request (\`apply --dry-run\`), apply on merge, and commit the files the apply rewrote. Two branches that each applied: merge them, then run the dry run. No changes means the merged files match the workspace. Exit ${SOURCE_STALE_EXIT_CODE} means a resource changed since the base this branch holds: \`sim workspaces source get --dir <fresh dir>\`, carry the edit over, and apply from there.
- \`sim workspaces source get --dir .\` refreshes the workspace \`${WORKSPACE_BASE_FILE}\` names, whatever the profile's default; a \`--workspace\` naming another is refused.
- One command at a time per directory: a second \`get\`, \`apply\` or \`check\` on the same directory exits ${SOURCE_BUSY_EXIT_CODE} while the first runs.

## Promote to another workspace

\`sim workspaces source apply --dir . --to <workspaceId> --dry-run\`, then \`--yes\`: applies this directory to another workspace (dev to prod). Each resource binds by key to the target's own: one the target holds under the same key is updated in place (a workflow keeps its id and block ids, so its webhook URLs), a key it lacks is created (or adopts a resource of the same name). Each promote records what it left in the target in \`.sim/targets/<workspaceId>.json\` (commit it), and the next promote compares with that: a resource changed in the target since is kept when this directory left it alone, and refused as stale (exit ${SOURCE_STALE_EXIT_CODE}) when this directory changed it too. A resource with no record (the first promote, or one created in the target since) is updated to match this directory; delete the record to take the target as it stands again. Secrets and credentials bind by name and key to the target's own; no value is copied. The target's resources this directory never declared (and no promote left there) are kept with a warning, even with \`--allow-delete\`; deleting them too takes \`--delete-target-only\` beside \`--allow-delete\`. A resource this directory deleted since the last promote is deleted in the target only with \`--allow-delete\`. Before the first promote, set the target's secrets (\`sim secrets set NAME --scope workspace -w <workspaceId>\`) and connect its credentials, or the workflows using them are held back. This directory stays bound to the workspace it was read from. Without \`--to\`, \`check\`, \`status\`, \`diff\` and \`apply\` act on the workspace this directory was read from, whatever the profile's default; a \`--workspace\` naming another is refused (\`SOURCE_OTHER_WORKSPACE\`).
`

/** The workspace directory's tree beside the printed source. */
export const WORKSPACE_TREE: SourceTreeProfile = {
  kind: 'workspace',
  agents: AGENTS_GUIDE,
  guides: [[WORKSPACE_ADVANCED_FILE, ADVANCED_GUIDE]],
  tsconfig: workspaceTsconfig,
  // Workspace files and knowledge base documents are bytes, kept as they are (`-text`, after the
  // LF lines it overrides): a commit that rewrote their line endings would change their hashes.
  gitattributes: [
    '*.ts text eol=lf',
    '*.js text eol=lf',
    '*.md text eol=lf',
    '*.json text eol=lf',
    `${KIND_DIRS.file}/** -text`,
    `${KIND_DIRS['knowledge-base']}/*/docs/** -text`,
  ],
  gitignore: [
    `${SOURCE_DOWNLOADS_DIR}/`,
    `${SOURCE_DIR_LOCK}/`,
    `${SOURCE_STAGING_PREFIX}*/`,
    // It includes the cached declarations by this machine's absolute path; `check` writes it again.
    TSCONFIG_FULL_FILE,
  ],
  sdk: Object.entries(WORKSPACE_SDK_DTS).map(
    ([name, text]) => [`${WORKSPACE_SDK_DIR}/${name}`, text] as const
  ),
  examples: Object.entries(WORKSPACE_COOKBOOK).map(
    ([path, text]) => [`${WORKSPACE_EXAMPLES_DIR}/${path}`, text] as const
  ),
}

/**
 * The keys a directory's files (path → text) declare, under the manifest list each kind's spec
 * names: its tables (typed from their declarations), its knowledge base, skill, custom tool and
 * workflow keys (grouped from their paths), and the secret names and credential keys its root
 * files declare (read from their text; a file that does not read declares none, and is still
 * typed live), with the modules those declarations live in. `workspace.d.ts` types them beside the
 * stored resources.
 */
export function localDeclarations(files: Readonly<Record<string, string>>): LocalDeclarations {
  const declared: LocalDeclarations = { declarationModules: DECLARATION_MODULES }
  for (const kind of APPLY_ORDER) {
    const list = WORKSPACE_KIND_SPECS[kind].manifestKey
    if (list === null) continue
    if (isFileKind(kind) && !Object.hasOwn(files, KIND_DIRS[kind])) continue
    const keys = declaredKeys(kind, files) ?? []
    if (list === 'workflows') declared.workflows = Object.fromEntries(keys.map((key) => [key, {}]))
    else declared[list] = keys
  }
  return declared
}

/**
 * The keys `files` (path → text) declare for `kind`: a root file's entries, or the resources its
 * folder's paths group into. `null` for a root file that is absent or does not read, whose keys
 * are unknown.
 */
function declaredKeys(
  kind: WorkspaceKind,
  files: Readonly<Record<string, string>>
): string[] | null {
  if (!isFileKind(kind)) {
    const paths = Object.keys(files).filter((path) => kindOfPath(path) === kind)
    return [...KIND_LAYOUTS[kind].group(paths).groups.keys()]
  }
  const file = KIND_DIRS[kind]
  if (!Object.hasOwn(files, file)) return null
  const read = FILE_KIND_CODECS[kind].parse(fileKindGroupKey(kind), { [file]: files[file] }, [])
  return read.decl ? Object.keys(read.decl) : null
}

/**
 * The kinds whose keys an offline check holds a workflow's references to. A skill counts too: a
 * built-in skill is stored by id and never printed as `skill('<key>')`, so a key names a
 * workspace skill, which a managed `skills/` folder declares.
 */
const CHECKED_REFERENCE_KINDS: readonly WorkspaceKind[] = [
  'credential',
  'custom-tool',
  'skill',
  'mcp-server',
  'table',
  'knowledge-base',
  'workflow',
]

/** A table column as a workflow's row writes name it. */
export interface DeclaredColumn {
  /** Its key in `tables/<key>.ts`, which differs from the name row writes use once `name` is set. */
  key: string
  /** The option names of a `select` column. */
  options?: readonly string[]
  /** A `select` column whose cells hold several options. */
  multiple?: boolean
}

/** What a workspace directory declares, for an offline compile of one of its workflows. */
export interface WorkspaceDeclarations {
  /** The names `secrets.ts` declares; absent when the directory has no readable file. */
  envNames?: ReadonlySet<string>
  /**
   * The keys declared for each resource kind a workflow names them by (`table`, `credential`,
   * …), for the kinds the directory manages (its folder or root file exists and reads): a get
   * writes every resource of such a kind, so a key outside the list names nothing an apply can
   * resolve.
   */
  keys: ReadonlyMap<string, ReadonlySet<string>>
  /** Each declared table's columns, by table key and then by stored column name. */
  tables: ReadonlyMap<string, ReadonlyMap<string, DeclaredColumn>>
  /**
   * What the declared rows of each table (`tables/<key>.rows.jsonl`) hold that an apply refuses,
   * each at its line: a line that is not a JSON object of declared columns, a managed key two
   * lines share, and a row the write refuses (`refusedTableRows`).
   */
  rowFindings: readonly RowFinding[]
  /** What `workspace.d.ts` types from the directory's declarations (`localDeclarations`). */
  local: LocalDeclarations
  /**
   * Each workflow's inputs (`startInputs`: its Start trigger's fields, `null` without one), by
   * key, for the workflows that compiled; set by a check, which compiles them.
   */
  workflowInputs?: ReadonlyMap<string, readonly WorkflowInput[] | null>
  /**
   * The keys of the workflows that compiled and end at a Response block on every run, whose
   * `result` is that block's output; set by a check, which compiles them.
   */
  respondingWorkflows?: ReadonlySet<string>
}

/**
 * A finding about a line of a table's rows file: `E_TABLE_ROWS`, an error, or the
 * `I_FINDINGS_TRUNCATED` that ends a long list.
 */
interface RowFinding {
  code: WorkspaceDiagnosticCode
  severity: FlatDiagnostic['severity']
  message: string
  hint?: string
  file: string
  line: number
  column: number
}

/**
 * Reads what the workspace directory `root` declares: its secret names, the keys of each
 * resource kind it manages, and its tables' columns. Only the root files and table files are read.
 */
export async function readWorkspaceDeclarations(root: string): Promise<WorkspaceDeclarations> {
  const { present, paths } = await kindFolders(root, APPLY_ORDER)
  const read = paths.filter((path) => {
    const kind = kindOfPath(path)
    return kind !== null && (isFileKind(kind) || kind === 'table')
  })
  const texts = await mapWithConcurrency(read, FILE_CONCURRENCY, (path) =>
    readSourceText(root, path)
  )
  const files: Record<string, string> = {}
  for (const path of paths) files[path] = ''
  read.forEach((path, index) => {
    files[path] = texts[index] ?? ''
  })
  const keys = new Map<string, ReadonlySet<string>>()
  for (const kind of CHECKED_REFERENCE_KINDS) {
    const resourceKind = WORKSPACE_KIND_SPECS[kind].resourceKind
    const declared = present.includes(kind) ? declaredKeys(kind, files) : null
    if (resourceKind !== null && declared !== null) keys.set(resourceKind, new Set(declared))
  }
  const secrets = present.includes('secret') ? declaredKeys('secret', files) : null
  const tables = new Map<string, ReadonlyMap<string, DeclaredColumn>>()
  const rowFindings: RowFinding[] = []
  for (const [key, tablePaths] of KIND_LAYOUTS.table.group(
    paths.filter((path) => kindOfPath(path) === 'table')
  ).groups) {
    const rowsPath = tableRowsPath(key)
    const { decl } = declaredTable(
      key,
      tablePaths.filter((path) => path !== rowsPath),
      files
    )
    if (!decl) continue
    tables.set(key, declaredColumns(decl))
    rowFindings.push(...tableRowFindings(key, decl, files[rowsPath]))
  }
  return {
    ...(secrets ? { envNames: new Set(secrets) } : {}),
    keys,
    tables,
    rowFindings,
    local: localDeclarations(files),
  }
}

/**
 * The findings of table `key`'s rows file, read against `decl` (its declaration, read without the
 * file): the reader's own (a line that is not a JSON object of declared columns, a managed key two
 * lines share) and each row the write refuses, at the row's line.
 */
function tableRowFindings(key: string, decl: TableDecl, text: string | undefined): RowFinding[] {
  const file = tableRowsPath(key)
  const rows = decl.rows
  if (!rows || text === undefined) return []
  const parsed = parseTableRows(key, text, rows, new Set(Object.keys(decl.columns)))
  const read = parsed.diagnostics.map(
    ({ code, severity, message, hint, span }): RowFinding => ({
      code,
      severity,
      message,
      ...(hint ? { hint } : {}),
      file,
      line: span?.line ?? 1,
      column: span?.column ?? 1,
    })
  )
  const refused = refusedTableRows(decl, parsed.data).map(
    ({ row, errors }): RowFinding => ({
      code: 'E_TABLE_ROWS',
      severity: 'error',
      message: `Line ${parsed.lines[row] ?? 1} does not fit the declared columns: ${errors.join('; ')}.`,
      hint: `Write a value each column of ${KIND_DIRS.table}/${key}${DECLARATION_EXTENSION} holds (a select cell names one of its options), fill every required column, and keep unique values unique.`,
      file,
      line: parsed.lines[row] ?? 1,
      column: 1,
    })
  )
  return [...read, ...refused]
}

/** A table declaration as the codec reads it, with its findings. */
type ParsedTable = ReturnType<ReturnType<typeof createTableCodec>['parse']>

/**
 * Each column helper call in `source` with its arguments' text up to the first `)`:
 * `column.select({ options: [...] })`. The next call is looked for after that `)`, and the walk
 * stops at the first call no `)` follows, so a file of unclosed calls is read once.
 */
function* columnCalls(source: string): Generator<[type: string, args: string]> {
  const head = /\bcolumn\.(\w+)\s*\(/g
  for (let match = head.exec(source); match !== null; match = head.exec(source)) {
    const open = match.index + match[0].length
    const close = source.indexOf(')', open)
    if (close === -1) return
    yield [match[1], source.slice(open, close)]
    head.lastIndex = close + 1
  }
}

/**
 * A table declaration as the codec reads it. The server's column-type catalog
 * is not at hand offline, so the codec is built over the types the file calls, each owning the
 * options its calls set (`options`, `multiple`, `currencyCode`) and taking `unique`: the dry run
 * checks the declaration itself against the real catalog.
 */
function declaredTable(
  key: string,
  paths: readonly string[],
  files: Readonly<Record<string, string>>
): ParsedTable {
  const text = Object.fromEntries(paths.map((path) => [path, files[path] ?? '']))
  const owned = new Map<string, Set<(typeof TABLE_COLUMN_METADATA_KEYS)[number]>>()
  for (const source of Object.values(text)) {
    for (const [type, args] of columnCalls(source)) {
      const owns = owned.get(type) ?? new Set()
      for (const option of TABLE_COLUMN_METADATA_KEYS) {
        if (new RegExp(`\\b${option}\\s*:`).test(args)) owns.add(option)
      }
      owned.set(type, owns)
    }
  }
  const codec = createTableCodec({
    types: Object.fromEntries(
      [...owned].map(([type, owns]) => [type, { owns: [...owns], unique: true }])
    ),
    maxOptions: Number.MAX_SAFE_INTEGER,
  })
  return codec.parse(key, text, [])
}

/**
 * The rows files of the tables `files` (a get's answer) declares seed rows for. A server read
 * prints a seed table's `rows` but never its rows, which only the directory holds, so a get keeps
 * the file it finds there.
 */
export function seedRowsFiles(files: Readonly<Record<string, string>>): Set<string> {
  const kept = new Set<string>()
  const paths = Object.keys(files).filter((path) => kindOfPath(path) === 'table')
  for (const [key, tablePaths] of KIND_LAYOUTS.table.group(paths).groups) {
    const rowsPath = tableRowsPath(key)
    const { decl } = declaredTable(
      key,
      tablePaths.filter((path) => path !== rowsPath),
      files
    )
    if (decl?.rows?.mode === 'seed') kept.add(rowsPath)
  }
  return kept
}

/** A table declaration's columns by stored name, as a workflow's row writes name them. */
function declaredColumns(decl: TableDecl): ReadonlyMap<string, DeclaredColumn> {
  return new Map(
    Object.entries(decl.columns).map(([columnKey, column]) => [
      columnName(columnKey, column),
      {
        key: columnKey,
        ...(column.options ? { options: column.options } : {}),
        ...(column.multiple ? { multiple: true } : {}),
      },
    ])
  )
}

/** Refuses a server answer naming a path outside every kind folder, before anything is written. */
export function assertWorkspacePaths(paths: Iterable<string>): void {
  for (const path of paths) {
    if (!isWorkspaceSourcePath(path)) {
      throw new SourceDirError(`The workspace source named an unsafe file path: ${path}`)
    }
  }
}

/** A workflow folder's CLI-only record (`.sim/stored-edges.json`): never sent, never ignored. */
function isWorkflowRecord(kind: WorkspaceKind, path: string): boolean {
  return kind === 'workflow' && path.endsWith(`/${SOURCE_STORED_EDGES_FILE}`)
}

/**
 * The folders (and root files) of `kinds`, each walked once: `present`, the kinds whose folder
 * holds any file (its `.gitkeep` marker included) or whose root file exists; `paths`, their source
 * files; and `ignored`, the rest (a hidden name, or a character no workspace path holds), which
 * are never sent. The marker is neither.
 */
export async function kindFolders(
  dir: string,
  kinds: readonly WorkspaceKind[]
): Promise<{ present: WorkspaceKind[]; paths: string[]; ignored: string[] }> {
  const present: WorkspaceKind[] = []
  const paths: string[] = []
  const ignored: string[] = []
  for (const kind of kinds) {
    if (isFileKind(kind)) {
      if ((await readSourceText(dir, KIND_DIRS[kind])) === null) continue
      present.push(kind)
      paths.push(KIND_DIRS[kind])
      continue
    }
    const files = await listSourceFiles(dir, KIND_DIRS[kind])
    if (files.length > 0) present.push(kind)
    for (const path of files) {
      if (isWorkspaceSourcePath(path)) paths.push(path)
      else if (path !== keepFile(kind) && !isWorkflowRecord(kind, path)) ignored.push(path)
    }
  }
  return { present, paths, ignored }
}

/**
 * Refuses a directory a workspace command would find nothing in, so a mistyped `--dir` or a
 * workflow folder fails instead of passing with nothing checked or applied.
 */
export async function assertWorkspaceDir(dir: string): Promise<void> {
  await assertSourceDirKind(dir, 'workspace')
  const { present } = await kindFolders(dir, APPLY_ORDER)
  if (present.length > 0) return
  throw new SourceDirError(
    `${dir} holds no workspace source (no kind folder such as ${KIND_DIRS.workflow}/ or ${KIND_DIRS.table}/). Point --dir at a directory \`sim workspaces source get\` wrote, or write one with \`sim workspaces source get --dir ${dir}\`.`
  )
}

/**
 * A kind folder's marker, so an emptied folder keeps managing its kind; `null` for a kind one root
 * file declares, which a get always writes.
 */
export function keepFile(kind: WorkspaceKind): string | null {
  return isFileKind(kind) ? null : `${KIND_DIRS[kind]}/${KEEP_FILE}`
}

/** What an apply sends, read from the directory. */
export interface WorkspaceSubmission {
  kinds: WorkspaceKind[]
  files: Record<string, string>
  blobs: BlobEntry[]
  base?: ApplyWorkspaceSourceBody['base']
  /** Files under a kind folder that are not sent: hidden names and unsupported characters. */
  ignored: string[]
  /**
   * Code files nothing names: under a workflow folder's `functions/`, one neither its `workflow.ts`
   * nor its lock names, and a tool's code file its declaration does not name. Never sent, as a
   * workflow directory's apply never sends them.
   */
  unnamed: string[]
  /** The blobs this read hashed or reused a recorded digest for, with their stats. */
  hashed: ReadonlyMap<string, StatDigest>
}

/** The tool a code file (`tools/<key>.js`) belongs to and its declaration path; `null` for any other path. */
export function toolOfCodeFile(path: string): { key: string; declaration: string } | null {
  if (kindOfPath(path) !== 'custom-tool') return null
  const [key] = toolCodec.group([path]).groups.keys()
  if (key === undefined) return null
  const declaration = toolDeclarationPath(key)
  return path === declaration ? null : { key, declaration }
}

/**
 * Whether `path` is a tool's code file that the tool's declaration does not name: the declaration
 * reads whole without it (its code is `stored()` or inline), so the server would only refuse it as
 * unused (`E_TOOL_CODE`). One with no declaration is still sent, so the server names what is
 * missing.
 */
function isUnnamedToolCode(files: Readonly<Record<string, string>>, path: string): boolean {
  const tool = toolOfCodeFile(path)
  const text = tool ? files[tool.declaration] : undefined
  if (!tool || text === undefined) return false
  return toolCodec.parse(tool.key, { [tool.declaration]: text }, []).decl !== undefined
}

/**
 * Drops from `files` each code file nothing names, returning their paths: a file under a workflow
 * folder's `functions/` that neither the folder's `workflow.ts` nor its lock names
 * ({@link codeFilePaths}, the rule a workflow directory's apply and status read), and a tool's code
 * file its declaration does not name ({@link isUnnamedToolCode}). An apply never sends one, so a
 * status never counts it as a change and the folder is not sent as edited for it.
 */
function dropUnnamedCodeFiles(files: Record<string, string>): string[] {
  const named = new Map<string, Set<string>>()
  const unnamed: string[] = []
  for (const path of Object.keys(files)) {
    if (isUnnamedToolCode(files, path)) {
      unnamed.push(path)
      delete files[path]
      continue
    }
    if (kindOfPath(path) !== 'workflow') continue
    const segments = path.split('/')
    if (segments[2] !== SOURCE_CODE_DIR) continue
    const folder = segments.slice(0, 2).join('/')
    let sent = named.get(folder)
    if (!sent) {
      let lock: unknown = null
      try {
        lock = JSON.parse(files[`${folder}/${SOURCE_LOCK_FILE}`] ?? 'null')
      } catch {}
      sent = new Set(codeFilePaths(files[`${folder}/${SOURCE_ENTRY_FILE}`] ?? null, lock))
      named.set(folder, sent)
    }
    if (!sent.has(segments.slice(2).join('/'))) {
      unnamed.push(path)
      delete files[path]
    }
  }
  return unnamed.sort(compareStrings)
}

/**
 * Drops from `files` the workflow folders whose every file is as `.sim/written.json` records it,
 * keeping what `unchangedFiles` sends for one (its base alone when it was read from
 * `workspaceId`): an apply sends only the workflows that were edited.
 */
function pruneUnchangedWorkflows(
  files: Record<string, string>,
  written: Written,
  workspaceId: string
): void {
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
}

/**
 * `submission` (read `whole`) as a read without `whole` sends it: its unchanged workflow folders
 * pruned for `workspaceId`, without walking, reading or hashing the directory again.
 */
export function withUnchangedWorkflowsPruned(
  submission: WorkspaceSubmission,
  written: Written,
  workspaceId: string
): WorkspaceSubmission {
  const files = { ...submission.files }
  pruneUnchangedWorkflows(files, written, workspaceId)
  return { ...submission, files }
}

/**
 * Reads the directory for an apply to `workspaceId`. A workflow folder whose every file is as the
 * CLI last wrote it is sent as `unchangedFiles` says (its base alone when it was read from
 * `workspaceId`), so an apply sends only the workflows that were edited, and a copy to another
 * workspace still sends every workflow it creates. `written` is `.sim/written.json` as the command
 * read it. Blobs are hashed as streams (reusing the digest `written` records for one whose size and
 * modification time are unchanged), and one over the size limit is refused (exit 7) before it is
 * read, as is a directory listing more blobs than one holds, before any is: the server would
 * refuse the apply only after every one was staged. `limits` are the server's
 * (`WORKSPACE_SOURCE_LIMITS`) unless given. With `whole`, every workflow folder is sent with its
 * files, as a status's dry run sends them so the server compares each with the stored workflow.
 */
export async function readWorkspaceDir(
  dir: string,
  only: readonly WorkspaceKind[] | undefined,
  workspaceId: string,
  written: Written,
  options: { whole?: boolean; limits?: { maxBlobs: number; maxBlobBytes: number } } = {}
): Promise<WorkspaceSubmission> {
  const { maxBlobs, maxBlobBytes } = options.limits ?? WORKSPACE_SOURCE_LIMITS
  const {
    present: kinds,
    paths,
    ignored,
  } = await kindFolders(
    dir,
    APPLY_ORDER.filter((kind) => !only || only.includes(kind))
  )
  const blobPaths = paths.filter(isBlobPath)
  if (blobPaths.length > maxBlobs) {
    throw new SourceDirError(
      `The directory lists ${blobPaths.length} binary files (files/ and knowledge documents), over the ${maxBlobs}-file limit; nothing was sent.`,
      { code: 'SOURCE_TOO_LARGE', exitCode: SOURCE_TOO_LARGE_EXIT_CODE }
    )
  }
  const textPaths = paths.filter((path) => !isBlobPath(path))
  const texts = await mapWithConcurrency(textPaths, FILE_CONCURRENCY, (path) =>
    readSourceText(dir, path)
  )
  const files: Record<string, string> = {}
  textPaths.forEach((path, index) => {
    const text = texts[index]
    if (text !== null) files[path] = text
  })
  const unnamed = dropUnnamedCodeFiles(files)
  if (!options.whole) pruneUnchangedWorkflows(files, written, workspaceId)
  const root = await realpath(dir)
  const verified = new Set<string>()
  const hashed = new Map<string, StatDigest>()
  const blobs = await mapWithConcurrency(
    blobPaths,
    FILE_CONCURRENCY,
    async (path): Promise<BlobEntry> => {
      const file = await checkedPath(root, path, verified)
      const current = await stat(file)
      const { size } = current
      if (size > maxBlobBytes) {
        throw new SourceDirError(`${path} is ${size} bytes, over the ${maxBlobBytes}-byte limit.`, {
          code: 'SOURCE_TOO_LARGE',
          exitCode: SOURCE_TOO_LARGE_EXIT_CODE,
        })
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
      throw new SourceDirError(
        `${WORKSPACE_BASE_FILE} in ${dir} is not valid JSON (a merge conflict?). Restore it from version control, or get the workspace into a fresh directory with \`sim workspaces source get --dir <fresh dir>\` and carry your edits over.`,
        { code: 'SOURCE_BASE_INVALID' }
      )
    }
  }
  return { kinds, files, blobs, ignored, unnamed, hashed, ...(base ? { base } : {}) }
}

/** `.sim/skipped.json`, or `null` when nothing was skipped. */
export function skippedFile(skipped: readonly unknown[]): string | null {
  return skipped.length > 0 ? `${JSON.stringify(skipped, null, 2)}\n` : null
}

/** `--only`'s help: every kind by its folder. */
export const ONLY_KINDS_HELP = `comma-separated folders: ${APPLY_ORDER.map((kind) => KIND_DIRS[kind]).join(', ')}`

/** `--only tables,workflows` (folders) or `--only table,workflow` (kinds) as kinds. */
export function parseKinds(value: string | undefined): WorkspaceKind[] | undefined {
  if (value === undefined) return undefined
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  if (names.length === 0) {
    throw new CliUsageError(
      `--only names no kind; name a folder (${[...KIND_BY_DIR.keys()].join(', ')}) or a kind (${APPLY_ORDER.join(', ')}).`
    )
  }
  const kinds = names.map((name) => (isWorkspaceKind(name) ? name : KIND_BY_DIR.get(name)))
  const unknown = names.filter((_, index) => kinds[index] === undefined)
  if (unknown.length > 0) {
    throw new CliUsageError(
      `Unknown kind ${unknown.join(', ')}; name a folder (${[...KIND_BY_DIR.keys()].join(', ')}) or a kind (${APPLY_ORDER.join(', ')}).`
    )
  }
  return [...new Set(kinds.filter((kind) => kind !== undefined))]
}
