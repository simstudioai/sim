import { join } from 'node:path'
import { isRecordLike, toRecord } from '@sim/utils/object'
import {
  type BlockCatalog,
  type CanonicalWorkflow,
  codeFrame,
  codePointLabel,
  compileWorkflow,
  didYouMean,
  encodeAnchor,
  parseJsonField,
  parseWorkflowLock,
  scriptName,
  startInputs,
  type Value,
  type WorkflowInput,
} from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { KIND_DIRS } from '@sim/workspace-code'
import { KIND_LAYOUTS } from '@sim/workspace-code/kinds/registry'
import type { Command } from 'commander'
import { profileFrom } from '../../context'
import { setSoftExitCode } from '../../embed-context'
import { SimApiError } from '../../http/client'
import { printProtocolResult } from './result'
import {
  absoluteDirOption,
  directoryWorkspace,
  readSourceJson,
  readSourceText,
  readStarterWorkspace,
  workspaceFolderOf,
} from './source-dir'
import {
  cachedCatalog,
  cachedSourceCatalog,
  type LocalDeclarations,
  refreshTsconfigs,
  refreshWorkspaceTypes,
} from './source-tree'
import { type Diagnostic, findingsOutput, verboseFlag } from './source-ui'
import { readStoredEdges } from './stored-edges'
import { readSourceFiles, requireEntry } from './workflow-source-apply'
import { WORKFLOW_TREE } from './workflow-source-get'
import {
  kindFolders,
  readWorkspaceDeclarations,
  WORKSPACE_TREE,
  type WorkspaceDeclarations,
} from './workspace-source-dir'

/**
 * A finding only the server can decide: `stored()` keeps a secret the stored workflow holds, and
 * a local compile has no stored workflow to read it from.
 */
const SERVER_ONLY_CODES: ReadonlySet<string> = new Set(['E_STORED_VALUE_MISSING'])

/**
 * Warnings an apply saves as written although the block they name is broken: a strict check
 * fails on them (see {@link StrictMode}).
 */
const STRICT_CODES: ReadonlySet<string> = new Set([
  'W_REQUIRED_MISSING',
  'W_UNKNOWN_OPTION',
  'W_UNKNOWN_OUTPUT_PATH',
  'W_VALUE_KIND',
  'W_OUT_OF_RANGE',
  'W_LITERAL_SECRET',
  'W_TABLE_UNKNOWN_COLUMN',
  'W_CHILD_INPUT_UNKNOWN',
  'W_BRANCH_UNWIRED',
])

/**
 * {@link STRICT_CODES} warnings the stored workflow exempts, which a check never fails on a block
 * the lock binds, `--strict` included: the server stays quiet when the stored workflow holds the
 * same state, and an offline check cannot read it. `W_BRANCH_UNWIRED`: a branch the stored
 * workflow leaves unwired.
 */
const STORED_EXEMPT_CODES: ReadonlySet<string> = new Set(['W_BRANCH_UNWIRED'])

/**
 * Warnings a check reports only on a block the lock does not bind (one added since the get), and
 * on every block with `--strict`: printed source holds them on blocks nobody edited, and the
 * server, which compares with the stored workflow, already reports them only for an edited field.
 * `W_JSON_REF_UNTYPED`: a bare reference nothing types, in a JSON field.
 */
const EDIT_SCOPED_CODES: ReadonlySet<string> = new Set(['W_JSON_REF_UNTYPED'])

/**
 * Which {@link STRICT_CODES} warnings fail a check: `new` those on a block the lock does not bind
 * (one added since the get, or every block of a workflow that has no lock yet), `all` every one,
 * `off` none. Printed source can hold such a warning on a block nobody edited (a field left empty
 * in the editor), so the default fails only on blocks the edit wrote.
 */
type StrictMode = 'new' | 'all' | 'off'

/**
 * The clause a warning ends with to say an apply saves the value anyway (`; it is kept as
 * written.`), dropped from a warning a check raises to an error, which nothing saves.
 */
const KEPT_AS_WRITTEN = /[;,] (?:it|the value|the text) is kept as written\.$/

/** One finding of a check, as the write commands print theirs. */
export type CheckFinding = Diagnostic

/** The `--strict` / `--no-strict` pair: absent selects the default, {@link StrictMode} `new`. */
export interface StrictOptions {
  strict?: boolean
}

/** The strict mode the `--strict` / `--no-strict` pair selects. */
export function strictMode(options: StrictOptions): StrictMode {
  if (options.strict === undefined) return 'new'
  return options.strict ? 'all' : 'off'
}

/** Help shared by both check commands: what fails, and the strict flags. */
export const STRICT_HELP = `Exit codes: 0 no errors; 1 errors (each printed as file:line:column with its frame and hint), or
no cached catalog (run the get once). With --output json, stdout is one document that also lists
every finding under diagnostics.

These warnings, which an apply saves as written, fail the check as errors on every block the lock
does not bind (a block added since the get, or every block of a new workflow):
${[...STRICT_CODES].map((code) => `  ${code}`).join(',\n')}.
--strict fails on them in every block, except ${[...STORED_EXEMPT_CODES].join(', ')} on a block the
lock binds (the stored workflow may hold it, and the server then stays quiet); --no-strict never
fails on a warning. ${[...EDIT_SCOPED_CODES].join(', ')} is reported only on blocks the lock does not
bind, and with --strict on every block.`

/** Adds the `--strict` / `--no-strict` pair to a check command. */
export function strictFlags(command: Command): Command {
  return command
    .option('--strict', 'Fail on the warnings listed below in every block, not only new ones')
    .option('--no-strict', 'Never fail on a warning')
}

const CHECK_HELP = `
Compiles workflow.ts (and the function files it names) with the compiler the server runs, against
the workspace's block catalog the last get or create cached, and prints the findings as the dry run
does. No request is made. It covers the source itself (syntax, builders, params, references,
wiring). In a workflow folder of a workspace directory (workflows/<key>), it reads the workspace's
.sim/base.json and also checks env names, resource keys and table columns against what the
directory declares. The dry run still checks what only the server knows (stored values,
deployment), so run it before applying. A check also adds the blocks the source now uses to the
CLI's tsconfig.json, so tsc type-checks a block the edit added; in a workspace directory it also
regenerates .sim/sdk/workspace.d.ts, so tsc types each workflow's inputs as its files declare them.

${STRICT_HELP}`

/** Every workflow key of the workspace directory `root` that has a `workflow.ts`. */
export async function workspaceWorkflowKeys(root: string): Promise<string[]> {
  const { paths } = await kindFolders(root, ['workflow'])
  return [...KIND_LAYOUTS.workflow.group(paths).groups]
    .filter(([key, folderPaths]) => folderPaths.includes(workflowEntry(key)))
    .map(([key]) => key)
}

/** A workflow's `workflow.ts`, relative to the workspace directory. */
function workflowEntry(key: string): string {
  return `${KIND_DIRS.workflow}/${key}/${SOURCE_ENTRY_FILE}`
}

/**
 * Points the workspace directory's tsconfig files at the blocks its workflows now use, keeping the
 * blocks they include.
 */
export async function refreshWorkspaceTsconfigs(root: string, workspaceId: string): Promise<void> {
  const keys = await workspaceWorkflowKeys(root)
  const sources = await Promise.all(keys.map((key) => readSourceText(root, workflowEntry(key))))
  await refreshTsconfigs(
    root,
    workspaceId,
    WORKSPACE_TREE,
    { sources: sources.filter((text) => text !== null) },
    { incremental: true }
  )
}

/** A canonical resource node: what `table('k')`, `credential('k')` and the like compile to. */
function resourceNode(value: unknown): { kind: string; key: string } | null {
  if (!isRecordLike(value) || value.$sim !== 'resource') return null
  const { kind, key } = value
  return typeof kind === 'string' && typeof key === 'string' ? { kind, key } : null
}

/** Every resource node inside a value, depth first. */
function resourceNodes(value: unknown): Array<{ kind: string; key: string }> {
  const node = resourceNode(value)
  if (node) return [node]
  if (Array.isArray(value)) return value.flatMap(resourceNodes)
  if (isRecordLike(value)) return Object.values(value).flatMap(resourceNodes)
  return []
}

/**
 * Why a key can never match: ` "triаge" holds U+0430, a Cyrillic letter; …` for a key with a
 * character outside lowercase ASCII (a resource key is `[a-z][a-z0-9_-]*`), which reads the same
 * as the declared key it imitates; empty for a key in the key format.
 */
function keyCharacterNote(key: string): string {
  const odd = [...key].find((character) => !/[a-z0-9_-]/.test(character))
  if (odd === undefined) return ''
  const script = scriptName(odd)
  return ` "${key}" holds ${codePointLabel(odd)}${script ? `, a ${script} letter` : ''}: a key is lowercase ASCII letters, digits, - and _, so retype it.`
}

/** How many keys a hint lists. */
const LISTED_KEYS = 20

function listed(keys: Iterable<string>): string {
  const all = [...keys]
  const more = all.length > LISTED_KEYS ? `, and ${all.length - LISTED_KEYS} more` : ''
  return `${all.slice(0, LISTED_KEYS).join(', ')}${more}`
}

/**
 * A row-write param's value as a JSON tree: compiled row data is JSON text whose non-string
 * references sit bare (`"n": <score.value>`), so it parses as a JSON field, references as leaves.
 */
function rowJson(value: Value): unknown {
  return typeof value === 'string' ? parseJsonField(value) : value
}

/** The params of a table block that hold row data: one row, or a list of rows. */
const ROW_PARAMS = ['data', 'rows'] as const

/**
 * A finding about one block param, located by the caller: at the param, or at the param whose
 * source names the resource key `names` (a source param name can differ from its canonical id).
 */
type ParamFinding = Pick<CheckFinding, 'code' | 'severity' | 'message' | 'hint'> & {
  block: string
  param: string
  names?: string
}

/** The `inputMapping` of a child workflow call, as a record of input name to value. */
function inputMappingOf(canonical: CanonicalWorkflow['blocks'][string]): Record<string, unknown> {
  const mapping = canonical.params.inputMapping
  if (mapping?.kind !== 'value') return {}
  const value = rowJson(mapping.value)
  return toRecord(value)
}

/**
 * A child workflow call checked against the child's own `workflow.ts` in this directory: a child
 * without a Start trigger (`W_CHILD_NO_START`), and an `inputMapping` key its Start trigger does
 * not declare (`W_CHILD_INPUT_UNKNOWN`). A child that did not compile is not checked.
 */
function childInputFindings(
  block: string,
  canonical: CanonicalWorkflow['blocks'][string],
  declarations: WorkspaceDeclarations
): ParamFinding[] {
  const ref = canonical.params.workflowId
  const child = ref?.kind === 'value' ? resourceNode(ref.value) : null
  if (child?.kind !== 'workflow') return []
  const inputs = declarations.workflowInputs?.get(child.key)
  if (inputs === undefined) return []
  const entry = `${KIND_DIRS.workflow}/${child.key}/${SOURCE_ENTRY_FILE}`
  if (inputs === null) {
    return [
      {
        code: 'W_CHILD_NO_START',
        severity: 'warning',
        message: `Workflow "${child.key}" has no Start trigger, so it takes no inputs and a call cannot run it.`,
        hint: `Add trigger.start('Start', { inputFormat: { … } }) to ${entry}, or call a workflow that has one.`,
        block,
        param: 'workflowId',
        names: child.key,
      },
    ]
  }
  const names = inputs.map((input) => input.name)
  return Object.keys(inputMappingOf(canonical))
    .filter((field) => !names.includes(field))
    .map((field) => ({
      code: 'W_CHILD_INPUT_UNKNOWN',
      severity: 'warning',
      message: `inputMapping sets ${field}, which is not an input of workflow "${child.key}"; the child never receives it.`,
      hint:
        names.length > 0
          ? `${didYouMean(field, names) ?? ''} Inputs (the Start trigger's inputFormat in ${entry}): ${listed(names)}.`.trimStart()
          : `The Start trigger of ${entry} declares no inputs: add ${field} to its inputFormat.`,
      block,
      param: 'inputMapping',
    }))
}

/**
 * The findings a compile cannot make without the workspace's declarations: a resource key the
 * directory does not declare (an apply fails on it), and a table row write naming a column, or a
 * select option, its table does not declare.
 */
function declarationFindings(
  workflow: CanonicalWorkflow,
  declarations: WorkspaceDeclarations
): ParamFinding[] {
  const findings: ParamFinding[] = []
  for (const [block, canonical] of Object.entries(workflow.blocks)) {
    const tables = new Set<string>()
    for (const [param, value] of Object.entries(canonical.params)) {
      for (const node of resourceNodes(value)) {
        if (node.kind === 'table') tables.add(node.key)
        const declared = declarations.keys.get(node.kind)
        if (!declared || declared.has(node.key)) continue
        const near = didYouMean(node.key, declared)
        findings.push({
          code: 'E_MAT_UNKNOWN_RESOURCE',
          severity: 'error',
          message: `No ${node.kind} "${node.key}" is declared in this workspace directory.${keyCharacterNote(node.key)}`,
          hint:
            declared.size > 0
              ? `${near ? `${near} ` : ''}Keys: ${listed(declared)}.`
              : `This directory declares no ${node.kind}: declare it before naming it.`,
          block,
          param,
          names: node.key,
        })
      }
    }
    findings.push(...childInputFindings(block, canonical, declarations))
    if (tables.size !== 1) continue
    const [table] = tables
    const columns = declarations.tables.get(table)
    if (!columns) continue
    for (const param of ROW_PARAMS) {
      const value = canonical.params[param]
      if (value?.kind !== 'value') continue
      const json = rowJson(value.value)
      for (const row of Array.isArray(json) ? json : [json]) {
        if (!isRecordLike(row)) continue
        for (const [field, cell] of Object.entries(row)) {
          const column = columns.get(field)
          if (!column) {
            findings.push({
              code: 'W_TABLE_UNKNOWN_COLUMN',
              severity: 'warning',
              message: `${param} writes ${field}, which is not a column of table "${table}"; the run drops it.`,
              hint: `${didYouMean(field, columns.keys()) ?? ''} Columns: ${listed(columns.keys())}.`.trimStart(),
              block,
              param,
            })
            continue
          }
          const { options } = column
          if (!options || column.multiple || typeof cell !== 'string' || cell.includes('<'))
            continue
          if (options.includes(cell)) continue
          findings.push({
            code: 'W_UNKNOWN_OPTION',
            severity: 'warning',
            message: `${field} of table "${table}" has no option ${cell}; it is kept as written.`,
            hint: `Options: ${options.join(', ')}.`,
            block,
            param,
          })
        }
      }
    }
  }
  return findings
}

/**
 * Compiles the workflow source directory `dir` against the catalog its base names when that one is
 * cached (a workflow holding a type the workspace catalog lacks was printed with its own), else
 * `catalog`, checking env names against the names `secrets.ts` declares when `declarations` hold
 * them.
 */
async function compileWorkflowDir(
  dir: string,
  workspaceCatalog: BlockCatalog,
  declarations?: WorkspaceDeclarations
) {
  const { lock } = parseWorkflowLock(await readSourceJson(dir, SOURCE_LOCK_FILE))
  const [files, storedEdges, printedWith] = await Promise.all([
    readSourceFiles(dir, lock ?? null),
    readStoredEdges(dir),
    cachedSourceCatalog(dir),
  ])
  const catalog = printedWith ?? workspaceCatalog
  const envNames = declarations?.envNames
  const compiled = compileWorkflow({
    entry: { path: SOURCE_ENTRY_FILE, text: files[SOURCE_ENTRY_FILE] },
    files: new Map(Object.entries(files).filter(([path]) => path !== SOURCE_ENTRY_FILE)),
    catalog,
    sdkMajor: catalog.sdkMajor,
    knownKeys: new Set(Object.keys(lock?.blocks ?? {})),
    storedUnread: lock ?? undefined,
    ...(storedEdges ? { storedUnreadEdges: storedEdges } : {}),
    ...(envNames ? { envNames, envDeclaredIn: KIND_DIRS.secret } : {}),
  })
  return { lock, files, compiled }
}

/**
 * The inputs of each workflow of the workspace directory `root` that compiles (`startInputs`,
 * `null` for one without a Start trigger), by key: what a child workflow call is checked against
 * and what `workspace.d.ts` types its `inputMapping` with.
 */
export async function workspaceWorkflowInputs(
  root: string,
  catalog: BlockCatalog
): Promise<Map<string, WorkflowInput[] | null>> {
  const inputs = new Map<string, WorkflowInput[] | null>()
  for (const key of await workspaceWorkflowKeys(root)) {
    const { compiled } = await compileWorkflowDir(join(root, KIND_DIRS.workflow, key), catalog)
    if (compiled.workflow) inputs.set(key, startInputs(compiled.workflow))
  }
  return inputs
}

/**
 * The workflows of `local` typed with the inputs each declares (`inputs`), for `workspace.d.ts`.
 */
export function withWorkflowInputs(
  local: LocalDeclarations,
  inputs: ReadonlyMap<string, readonly WorkflowInput[] | null>
): LocalDeclarations {
  const workflows = { ...local.workflows }
  for (const [key, fields] of inputs) {
    workflows[key] = {
      inputs: Object.fromEntries((fields ?? []).map((field) => [field.name, field.type])),
    }
  }
  return { ...local, workflows }
}

/**
 * Compiles one workflow source directory offline against `catalog`, with the workspace's
 * declarations when the directory sits in a workspace directory, and returns its findings with
 * the {@link STRICT_CODES} the strict mode fails on raised to errors, and the `workflow.ts` text.
 * `prefix` goes before each file path (`workflows/<key>/` in a workspace check).
 */
export async function checkWorkflowDir(
  dir: string,
  catalog: BlockCatalog,
  options: { declarations?: WorkspaceDeclarations; strict: StrictMode; prefix?: string }
): Promise<{ findings: CheckFinding[]; entry: string }> {
  const { lock, files, compiled } = await compileWorkflowDir(dir, catalog, options.declarations)
  const entryText = files[SOURCE_ENTRY_FILE]
  const locate = (block: string, param: string, names: string | undefined) => {
    const prefix = encodeAnchor({ kind: 'param', block, param: '' })
    const naming =
      names === undefined
        ? undefined
        : Object.entries(compiled.spans).find(
            ([anchor, span]) =>
              anchor.startsWith(prefix) &&
              span !== undefined &&
              span.file === SOURCE_ENTRY_FILE &&
              ['"', "'", '`'].some((quote) =>
                entryText.slice(span.start, span.end).includes(`${quote}${names}${quote}`)
              )
          )?.[1]
    return (
      naming ??
      compiled.spans[encodeAnchor({ kind: 'param', block, param })] ??
      compiled.spans[encodeAnchor({ kind: 'block', block })]
    )
  }
  const declared =
    compiled.workflow && options.declarations
      ? declarationFindings(compiled.workflow, options.declarations).map(
          ({ block, param, names, ...finding }) => {
            const span = locate(block, param, names)
            const text = span ? files[span.file] : undefined
            return {
              ...finding,
              blockKey: block,
              ...(span ? { span } : {}),
              ...(span && text !== undefined ? { frame: codeFrame(text, span) } : {}),
            }
          }
        )
      : []
  const bound = (blockKey: string | undefined) =>
    lock !== undefined && blockKey !== undefined && Object.hasOwn(lock.blocks, blockKey)
  const fails = (code: string, blockKey: string | undefined) =>
    STRICT_CODES.has(code) &&
    !(STORED_EXEMPT_CODES.has(code) && bound(blockKey)) &&
    (options.strict === 'all' || (options.strict === 'new' && !bound(blockKey)))
  const prefix = options.prefix ?? ''
  const reported = (code: string, blockKey: string | undefined) =>
    !SERVER_ONLY_CODES.has(code) &&
    !(EDIT_SCOPED_CODES.has(code) && options.strict !== 'all' && bound(blockKey))
  const findings = [
    ...compiled.diagnostics.filter((diagnostic) => reported(diagnostic.code, diagnostic.blockKey)),
    ...declared,
  ].map(({ code, severity, message, hint, frame, span, blockKey }): CheckFinding => {
    const raised = severity === 'warning' && fails(code, blockKey)
    return {
      code,
      severity: raised ? 'error' : severity,
      message: raised ? message.replace(KEPT_AS_WRITTEN, '.') : message,
      ...(hint !== undefined ? { hint } : {}),
      ...(frame !== undefined ? { frame } : {}),
      ...(span ? { file: `${prefix}${span.file}`, line: span.line, column: span.column } : {}),
    }
  })
  return { findings, entry: entryText }
}

/**
 * Prints a check's findings and result, and exits 1 on any error. `verbose` keeps info findings in
 * a machine result.
 */
export function reportCheck(
  output: Parameters<typeof printProtocolResult>[0],
  findings: CheckFinding[],
  result: Record<string, unknown>,
  verbose = false
): void {
  const shown = findingsOutput(output, verbose)
  shown.print(findings)
  const errors = findings.filter((finding) => finding.severity === 'error').length
  if (errors > 0) setSoftExitCode(1)
  printProtocolResult(output, {
    checked: 'compile',
    errors,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    ...result,
    ...shown.result(findings),
  })
}

/** The catalog a cache read found, or a refusal naming `get`, the command that caches one. */
function cachedOrRefuse(
  catalog: BlockCatalog | null,
  workspaceId: string,
  get: string
): BlockCatalog {
  if (catalog) return catalog
  throw new SimApiError(
    `No block catalog is cached for workspace ${workspaceId}. Run ${get} once, then check again.`,
    0,
    'CATALOG_NOT_CACHED'
  )
}

/** The cached catalog of `workspaceId`, or a refusal naming `get`, the command that caches one. */
export function requireCachedCatalog(workspaceId: string, get: string): BlockCatalog {
  return cachedOrRefuse(cachedCatalog(workspaceId), workspaceId, get)
}

/**
 * `sim workflows source check [--dir <dir>]`: compiles a source directory locally with the bundled
 * compiler and the cached catalog, so an agent's edit loop gets syntax and builder findings in
 * milliseconds and without the network. The dry run stays the authority.
 */
export function attachWorkflowSourceCheck(source: Command): void {
  verboseFlag(
    strictFlags(
      absoluteDirOption(source.command('check')).option(
        '--dir <dir>',
        'Source directory: workflow.ts, functions/* and .sim/',
        '.'
      )
    )
  )
    .allowExcessArguments(false)
    .description('Compile a workflow source directory locally, without the server')
    .addHelpText('after', CHECK_HELP)
    .action(
      async (options: { dir: string; verbose?: boolean } & StrictOptions, command: Command) => {
        const profile = profileFrom(command)
        const base = toRecord(await readSourceJson(options.dir, SOURCE_BASE_FILE))
        if (
          typeof base.workspaceId === 'string' &&
          base.workflowId === undefined &&
          (await readSourceText(options.dir, SOURCE_ENTRY_FILE)) === null
        ) {
          throw new SimApiError(
            `${options.dir} is a workspace source directory: check it with \`sim workspaces source check --dir ${options.dir}\`.`,
            0
          )
        }
        await requireEntry(options.dir)
        const workspace = await workspaceFolderOf(options.dir)
        const recorded =
          typeof base.workspaceId === 'string'
            ? base.workspaceId
            : (workspace?.workspaceId ??
              (profile.sources.workspaceId === 'flag'
                ? null
                : await readStarterWorkspace(options.dir)))
        const workspaceId = directoryWorkspace(
          options.dir,
          recorded,
          profile,
          (from) => `Run it without --workspace to check it against the catalog of ${from}.`
        )
        if (!workspaceId) {
          throw new SimApiError(
            `${options.dir} has no ${SOURCE_BASE_FILE} and no workspace is selected: pass --workspace <workspaceId>.`,
            0
          )
        }
        const catalog = cachedOrRefuse(
          (await cachedSourceCatalog(options.dir)) ?? cachedCatalog(workspaceId),
          workspaceId,
          workspace
            ? `\`sim workspaces source get --dir ${workspace.root}\``
            : `\`sim workflows source get <workflowId> --dir ${options.dir}\` (or \`create\`)`
        )
        const declarations = workspace
          ? {
              ...(await readWorkspaceDeclarations(workspace.root)),
              workflowInputs: await workspaceWorkflowInputs(workspace.root, catalog),
            }
          : undefined
        const { findings, entry } = await checkWorkflowDir(options.dir, catalog, {
          strict: strictMode(options),
          ...(declarations ? { declarations } : {}),
        })
        if (workspace && declarations) {
          await refreshWorkspaceTypes(
            workspace.root,
            withWorkflowInputs(declarations.local, declarations.workflowInputs)
          )
          await refreshWorkspaceTsconfigs(workspace.root, workspaceId)
        } else {
          await refreshTsconfigs(
            options.dir,
            workspaceId,
            WORKFLOW_TREE,
            { sources: [entry] },
            { incremental: true }
          )
        }
        reportCheck(profile.output, findings, { catalogHash: catalog.hash }, options.verbose)
      }
    )
}
