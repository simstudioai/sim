/**
 * The local check of a workflow source directory, shared by `workflows source check` and
 * `workspaces source check`: compiling a workflow directory against the cached catalog and the
 * workspace's declarations, the `--strict` rule, and how a check reports.
 */

import { join } from 'node:path'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { collectStringLeaves, findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import {
  type BlockCatalog,
  type CanonicalWorkflow,
  catalogBlock,
  codeFrame,
  codePointLabel,
  compileWorkflow,
  didYouMean,
  EDIT_REFUSALS,
  encodeAnchor,
  formatStoredPath,
  getOwn,
  parseJsonField,
  parseStoredPath,
  parseWorkflowLock,
  RESPONSE_OUTPUTS,
  raisedMessage,
  refuseEditedFindings,
  refusesEdited,
  respondsOnEveryRun,
  scriptName,
  startInputs,
  type Value,
  type WorkflowInput,
} from '@sim/workflow-code'
import { type AnswerBound, boundAnswerFindings } from '@sim/workflow-code/diagnostics'
import { SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { KIND_DIRS } from '@sim/workspace-code'
import { KIND_LAYOUTS } from '@sim/workspace-code/kinds/registry'
import type { Command } from 'commander'
import { setSoftExitCode } from '../../embed-context'
import { SourceDirError } from './local-errors'
import { printProtocolResult } from './result'
import { digest, readFolderWritten, readSourceText } from './source-dir'
import { STRICT_FINDINGS } from './source-strict'
import {
  cachedCatalog,
  cachedSourceCatalog,
  type LocalDeclarations,
  refreshTsconfigs,
} from './source-tree'
import { type Diagnostic, findingsOutput } from './source-ui'
import { blockDigest, readStoredBlockDigests, readStoredEdges } from './stored-edges'
import { lockRecoveryHint, readSourceFiles } from './workflow-dir'
import {
  type DeclaredColumn,
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
const STRICT_CODES: ReadonlySet<string> = new Set(STRICT_FINDINGS.keys())

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

/** Where each kind of edit refusal applies, as the help says it. */
const REFUSAL_WHERE: Record<(typeof EDIT_REFUSALS)[number]['where'], string> = {
  'changed block': 'in any file of a block the edit added or changed',
  'workflow.ts': 'in workflow.ts on a block the edit added or changed',
  'edited code file': 'in a function file changed since the get',
}

/** Help shared by both check commands: what fails, and the strict flags. */
export const STRICT_HELP = `Exit codes: 0 no errors; 1 errors (each printed as file:line:column with its frame and hint), or
no cached catalog (run the get once). With --output json, stdout is one document that also lists
every finding under diagnostics.

These warnings, which an apply saves as written, fail the check as errors on every block the lock
does not bind (a block added since the get, or every block of a new workflow):
${[...STRICT_CODES].map((code) => `  ${code}`).join(',\n')}.
--strict fails on them in every block, except ${[...STORED_EXEMPT_CODES].join(', ')} on a block the
lock binds (the stored workflow may hold it, and the server then stays quiet); --no-strict fails
on none of them. In every mode, as the server refuses them: ${EDIT_REFUSALS.map(
  ({ warning, refusal, where }) => `${warning} is the error ${refusal} ${REFUSAL_WHERE[where]}`
).join('; ')}. A block counts as changed when the lock does not bind it, when the source moved it
into another container, or when it compiles differently than in the source the last get or
apply printed (.sim/stored-edges.json records a digest of each block). That last comparison
needs the catalog the source was printed with in the cache: without it, a bound block that did
not move counts as unchanged, so the server may refuse what the check passes. A $ref in a
function file to a block the lock binds that the source no longer declares stays a warning, unless
a warning cap left findings out: the server may infer that block was renamed and rewrite the
reference, and refuses it otherwise.
${[...EDIT_SCOPED_CODES].join(', ')} is reported only on blocks the lock does not bind, and with
--strict on every block.`

/** Adds the `--strict` / `--no-strict` pair to a check command. */
export function strictFlags(command: Command): Command {
  return command
    .option('--strict', 'Fail on the warnings listed below in every block, not only new ones')
    .option('--no-strict', 'Never fail on a warning an apply saves')
}

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

/** The workflow a child workflow call names by key, or `null` for an id, a reference or none. */
function calledWorkflowKey(canonical: CanonicalWorkflow['blocks'][string]): string | null {
  const ref = canonical.params.workflowId
  const child = ref?.kind === 'value' ? resourceNode(ref.value) : null
  return child?.kind === 'workflow' ? child.key : null
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
  const childKey = calledWorkflowKey(canonical)
  if (childKey === null) return []
  const inputs = declarations.workflowInputs?.get(childKey)
  if (inputs === undefined) return []
  const entry = `${KIND_DIRS.workflow}/${childKey}/${SOURCE_ENTRY_FILE}`
  if (inputs === null) {
    return [
      {
        code: 'W_CHILD_NO_START',
        severity: 'warning',
        message: `Workflow "${childKey}" has no Start trigger, so it takes no inputs and a call cannot run it.`,
        hint: `Add trigger.start('Start', { inputFormat: { … } }) to ${entry}, or call a workflow that has one.`,
        block,
        param: 'workflowId',
        names: childKey,
      },
    ]
  }
  const names = inputs.map((input) => input.name)
  return Object.keys(inputMappingOf(canonical))
    .filter((field) => !names.includes(field))
    .map((field) => ({
      code: 'W_CHILD_INPUT_UNKNOWN',
      severity: 'warning',
      message: `inputMapping sets ${field}, which is not an input of workflow "${childKey}"; the child never receives it.`,
      hint:
        names.length > 0
          ? `${didYouMean(field, names) ?? ''} Inputs (the Start trigger's inputFormat in ${entry}): ${listed(names)}.`.trimStart()
          : `The Start trigger of ${entry} declares no inputs: add ${field} to its inputFormat.`,
      block,
      param: 'inputMapping',
    }))
}

/**
 * `W_CHILD_RESULT_PATH` for each reference to `<call.result.<key>>` whose call runs a workflow of
 * this directory that ends at a Response block on every run, when `<key>` is not one of the
 * Response block's outputs: the child's `result` is then `{ data, status, headers }`, so the path
 * reads nothing at run time. A child that can end elsewhere returns the output of the block it
 * ends at, which the path may read, so its calls are not judged.
 */
function childResultFindings(
  workflow: CanonicalWorkflow,
  declarations: WorkspaceDeclarations
): ParamFinding[] {
  const responding = declarations.respondingWorkflows
  if (!responding || responding.size === 0) return []
  const calls = new Map<string, string>()
  for (const [key, block] of Object.entries(workflow.blocks)) {
    const child = calledWorkflowKey(block)
    if (child !== null && responding.has(child)) calls.set(key, child)
  }
  if (calls.size === 0) return []
  const findings: ParamFinding[] = []
  for (const [block, canonical] of Object.entries(workflow.blocks)) {
    for (const [param, value] of Object.entries(canonical.params)) {
      if (value.kind !== 'value') continue
      const reported = new Set<string>()
      const leaves: string[] = []
      collectStringLeaves(value.value, leaves)
      for (const text of leaves) {
        for (const token of findWorkflowReferenceTokens(text)) {
          if (token.kind !== 'workflow' || reported.has(token.value)) continue
          const segments = parseStoredPath(token.value.slice(1, -1))
          const [head, output, field, ...rest] = segments ?? []
          const child = head?.kind === 'name' ? calls.get(head.name) : undefined
          if (child === undefined || output?.kind !== 'name' || output.name !== 'result') continue
          if (field?.kind !== 'name' || RESPONSE_OUTPUTS.includes(field.name)) continue
          reported.add(token.value)
          const meant = formatStoredPath([
            head,
            output,
            { kind: 'name', name: 'data' },
            field,
            ...rest,
          ])
          findings.push({
            code: 'W_CHILD_RESULT_PATH',
            severity: 'warning',
            message: `${token.value} reads ${field.name} from the result of workflow "${child}", which responds: its result is the Response output ({ data, status, headers }), so the path reads nothing.`,
            hint: `Did you mean <${meant}>? A field of the child's Response data is result.data.${field.name}.`,
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
 * `W_TABLE_UNKNOWN_COLUMN` for a row write's `field` that names no column of `table`. A row is
 * keyed by column name, so a field that is the key of a column `name` renamed points at that name.
 */
function unknownColumnFinding(
  table: string,
  columns: ReadonlyMap<string, DeclaredColumn>,
  field: string,
  block: string,
  param: string
): ParamFinding {
  const finding = { code: 'W_TABLE_UNKNOWN_COLUMN', severity: 'warning', block, param } as const
  const renamed = [...columns].find(([, column]) => column.key === field)?.[0]
  if (renamed) {
    return {
      ...finding,
      message: `${param} writes ${field}, the key of column "${renamed}" of table "${table}": row data is keyed by column name, so the run drops it.`,
      hint: `Did you mean ${renamed}?`,
    }
  }
  return {
    ...finding,
    message: `${param} writes ${field}, which is not a column of table "${table}"; the run drops it.`,
    hint: `${didYouMean(field, columns.keys()) ?? ''} Columns: ${listed(columns.keys())}.`.trimStart(),
  }
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
            findings.push(unknownColumnFinding(table, columns, field, block, param))
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
  findings.push(...childResultFindings(workflow, declarations))
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
  const lockText = await readSourceText(dir, SOURCE_LOCK_FILE)
  const parsedLock = lockText === null ? null : parseWorkflowLock(lockText)
  const lock = parsedLock?.lock
  const [files, storedEdges, storedBlocks, printedWith] = await Promise.all([
    readSourceFiles(dir, lock ?? null),
    readStoredEdges(dir),
    readStoredBlockDigests(dir),
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
  return {
    lock,
    lockProblems: parsedLock?.diagnostics ?? [],
    files,
    compiled,
    storedBlocks,
    printedWith,
    catalog,
  }
}

/**
 * The workspace directory `root`'s declarations, with what a child workflow call is checked
 * against from compiling each of its workflows: the inputs of each workflow that compiles
 * (`startInputs`, `null` without a Start trigger), which `workspace.d.ts` also types
 * `inputMapping` with, and the keys of those that end at a Response block on every run, whose
 * `result` is that block's output.
 */
export async function readCheckDeclarations(
  root: string,
  catalog: BlockCatalog
): Promise<WorkspaceDeclarations & Awaited<ReturnType<typeof compileWorkspaceWorkflows>>> {
  const [declared, workflows] = await Promise.all([
    readWorkspaceDeclarations(root),
    compileWorkspaceWorkflows(root, catalog),
  ])
  return { ...declared, ...workflows }
}

async function compileWorkspaceWorkflows(root: string, catalog: BlockCatalog) {
  const workflowInputs = new Map<string, WorkflowInput[] | null>()
  const respondingWorkflows = new Set<string>()
  for (const key of await workspaceWorkflowKeys(root)) {
    const { compiled } = await compileWorkflowDir(join(root, KIND_DIRS.workflow, key), catalog)
    if (!compiled.workflow) continue
    workflowInputs.set(key, startInputs(compiled.workflow))
    if (respondsOnEveryRun(compiled.workflow)) respondingWorkflows.add(key)
  }
  return { workflowInputs, respondingWorkflows }
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
): Promise<{ findings: CheckFinding[]; entry: string; unlisted: UnlistedCounts }> {
  const compiledDir = await compileWorkflowDir(dir, catalog, options.declarations)
  const { lock, lockProblems, files, compiled, storedBlocks, printedWith } = compiledDir
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
  const written = await readFolderWritten(dir)
  // A file only moved from the path the lock bound its block to is unedited while its text matches that path's digest.
  const edited = (file: string, blockKey: string | undefined) => {
    const text = files[file]
    if (text === undefined) return true
    const textDigest = digest(text)
    if (written.digests[file] === textDigest) return false
    const previousFile =
      lock && blockKey !== undefined && Object.hasOwn(lock.blocks, blockKey)
        ? lock.blocks[blockKey].codeFile
        : undefined
    return previousFile === undefined || written.digests[previousFile] !== textDigest
  }
  const moved = (blockKey: string) => {
    const held = lock ? getOwn(lock.blocks, blockKey) : undefined
    const block = compiled.workflow ? getOwn(compiled.workflow.blocks, blockKey) : undefined
    return held !== undefined && block !== undefined && held.parent !== block.parent
  }
  /**
   * Whether the edit added, moved or changed the block. A block's digest is compared only when
   * the catalog it was printed with is cached: against another catalog every block may compile
   * differently, and a check prefers a warning to a refusal the server would not make.
   */
  const changed = (blockKey: string) => {
    if (!bound(blockKey) || moved(blockKey)) return true
    const block = compiled.workflow?.blocks[blockKey]
    const printed = printedWith ? storedBlocks?.get(blockKey) : undefined
    return block !== undefined && printed !== undefined && blockDigest(block) !== printed
  }
  const fails = (code: string, blockKey: string | undefined) =>
    STRICT_CODES.has(code) &&
    !(STORED_EXEMPT_CODES.has(code) && bound(blockKey)) &&
    (options.strict === 'all' || (options.strict === 'new' && !bound(blockKey)))
  const prefix = options.prefix ?? ''
  const reported = (code: string, blockKey: string | undefined) =>
    !SERVER_ONLY_CODES.has(code) &&
    !(EDIT_SCOPED_CODES.has(code) && options.strict !== 'all' && bound(blockKey))
  /**
   * Whether the code `blockKey` runs from `file` changed, as the server compares it: the file's
   * text, or a bound block now pointed at another file whose text differs from what it ran.
   */
  const codeEdited = (blockKey: string, file: string) => {
    if (edited(file, blockKey)) return true
    const before = lock ? getOwn(lock.blocks, blockKey)?.codeFile : undefined
    const text = files[file]
    return (
      before !== undefined &&
      before !== file &&
      text !== undefined &&
      written.digests[before] !== digest(text)
    )
  }
  const removedKeys = new Set(
    Object.keys(lock?.blocks ?? {}).filter(
      (key) => !compiled.workflow || getOwn(compiled.workflow.blocks, key) === undefined
    )
  )
  /**
   * A refused `$ref` in a code file naming a block the lock binds that the source no longer
   * declares: the server may infer that block's rename (name and const both changed) and then
   * rewrite the reference, which only it can tell, so the check keeps the warning.
   */
  // Past a warning cap the compile keeps one finding per code, block and file, which could stand
  // for a reference no rename settles, so then nothing is exempt.
  const listedEvery = !compiled.diagnostics.some((d) => d.code === 'I_FINDINGS_TRUNCATED')
  const mayBeRenamed = (finding: (typeof compiled.diagnostics)[number]) => {
    if (!listedEvery || finding.code !== 'W_UNRESOLVED_REF') return false
    if (finding.span.file === SOURCE_ENTRY_FILE) return false
    const text = files[finding.span.file]?.slice(finding.span.start, finding.span.end) ?? ''
    const head = /^(?:\$ref\.|<)([A-Za-z0-9_]+)/.exec(text)?.[1]
    return head !== undefined && removedKeys.has(head)
  }
  /**
   * A dropdown value outside options that vary with deployment settings (`optionsVary`): the
   * cached catalog may have been built under other settings than the server's gate runs with, so
   * the check keeps the warning and leaves the verdict to the server.
   */
  const variesByDeployment = (finding: { code: string; blockKey?: string; param?: string }) => {
    const { blockKey, param } = finding
    if (finding.code !== 'W_UNKNOWN_OPTION' || blockKey === undefined || param === undefined) {
      return false
    }
    const type = compiled.workflow ? getOwn(compiled.workflow.blocks, blockKey)?.type : undefined
    const block = type === undefined ? undefined : catalogBlock(compiledDir.catalog, type)
    return block?.subBlocks.some((sub) => sub.id === param && sub.optionsVary === true) === true
  }
  const exempt = (finding: (typeof compiled.diagnostics)[number]) =>
    mayBeRenamed(finding) || variesByDeployment(finding)
  const refusable = (finding: (typeof compiled.diagnostics)[number]) => !exempt(finding)
  const refused = [
    ...refuseEditedFindings(
      {
        diagnostics: compiled.diagnostics.filter(refusable),
        withheld: compiled.withheld.filter(refusable),
      },
      { changed, codeEdited }
    ),
    ...compiled.diagnostics.filter(exempt),
  ]
  const lockFindings = lockProblems.map(
    (problem): CheckFinding => ({
      code: problem.code,
      severity: 'error',
      message: `${problem.message} Every apply and status refuses this lock.`,
      hint: lockRecoveryHint(
        options.declarations
          ? '`sim workspaces source get --dir <new dir>`, from the workspace directory'
          : undefined
      ),
      file: `${prefix}${SOURCE_LOCK_FILE}`,
      ...(problem.path ? { path: problem.path } : {}),
    })
  )
  const findings = [
    ...refused.filter((diagnostic) => reported(diagnostic.code, diagnostic.blockKey)),
    ...declared,
  ].map((finding): CheckFinding => {
    const { code, severity, message, hint, frame, span, blockKey } = finding
    const raised = severity === 'warning' && !variesByDeployment(finding) && fails(code, blockKey)
    return {
      code,
      severity: raised ? 'error' : severity,
      message: raised ? raisedMessage(message) : message,
      ...(hint !== undefined ? { hint } : {}),
      ...(frame !== undefined ? { frame } : {}),
      ...(span ? { file: `${prefix}${span.file}`, line: span.line, column: span.column } : {}),
    }
  })
  // The warnings the compile's caps left out are counted as the listed ones would be: a withheld
  // one a refusal raised is listed already; an omitted refusable one (it keeps its file and
  // field) is an error wherever the apply would refuse it.
  const unlisted: UnlistedCounts = { errors: 0, warnings: 0 }
  const edit = { changed, codeEdited }
  for (const { code, blockKey, count, varies, refused: isRefused } of [
    ...compiled.omitted.map((omitted) => {
      const finding = {
        code: omitted.code,
        severity: 'warning',
        ...(omitted.blockKey !== undefined ? { blockKey: omitted.blockKey } : {}),
        ...(omitted.param !== undefined ? { param: omitted.param } : {}),
      }
      const varies = variesByDeployment(finding)
      return {
        ...omitted,
        varies,
        refused:
          !varies &&
          omitted.file !== undefined &&
          refusesEdited({ ...finding, span: { file: omitted.file } }, edit),
      }
    }),
    ...compiled.withheld
      .filter((finding) => !refusable(finding) || !refusesEdited(finding, edit))
      .map((finding) => ({
        code: finding.code,
        blockKey: finding.blockKey,
        count: 1,
        varies: variesByDeployment(finding),
        refused: false,
      })),
  ]) {
    if (!reported(code, blockKey)) continue
    if (isRefused || (!varies && fails(code, blockKey))) unlisted.errors += count
    else unlisted.warnings += count
  }
  return { findings: [...lockFindings, ...findings], entry: entryText, unlisted }
}

/** Findings a check counts but does not list: those the compile's caps left out. */
interface UnlistedCounts {
  errors: number
  warnings: number
}

/**
 * Prints a check's findings and result, and exits 1 on any error. The findings are bounded as the
 * server bounds an answer of the same source (`bound`, the workflow answer's by default), while
 * `errors` and `warnings` count every one. `verbose` keeps info findings in a machine result.
 */
export function reportCheck(
  output: Parameters<typeof printProtocolResult>[0],
  findings: CheckFinding[],
  result: Record<string, unknown>,
  options: {
    verbose?: boolean
    bound?: AnswerBound
    unlisted?: UnlistedCounts
    /** The source directory, which GitHub Actions annotations resolve finding files under. */
    dir?: string
  } = {}
): void {
  const shown = findingsOutput(output, options.verbose, options.dir)
  const listed = boundAnswerFindings(findings, options.bound)
  shown.print(listed)
  const unlisted = options.unlisted ?? { errors: 0, warnings: 0 }
  const errors = findings.filter((finding) => finding.severity === 'error').length + unlisted.errors
  if (errors > 0) setSoftExitCode(1)
  printProtocolResult(output, {
    checked: 'compile',
    errors,
    warnings:
      findings.filter((finding) => finding.severity === 'warning').length + unlisted.warnings,
    ...result,
    ...shown.result(listed),
  })
}

/** The catalog a cache read found, or a refusal naming `get`, the command that caches one. */
export function cachedOrRefuse(
  catalog: BlockCatalog | null,
  workspaceId: string,
  get: string
): BlockCatalog {
  if (catalog) return catalog
  throw new SourceDirError(
    `No block catalog is cached for workspace ${workspaceId}. Run ${get} once, then check again.`,
    { code: 'CATALOG_NOT_CACHED' }
  )
}

/** The cached catalog of `workspaceId`, or a refusal naming `get`, the command that caches one. */
export function requireCachedCatalog(workspaceId: string, get: string): BlockCatalog {
  return cachedOrRefuse(cachedCatalog(workspaceId), workspaceId, get)
}
