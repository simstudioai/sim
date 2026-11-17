import { createInterface } from 'node:readline/promises'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { CODE_FILE_EXTENSIONS, SOURCE_ENTRY_FILE as ENTRY_FILE } from '@sim/workflow-code/limits'
import type { Command } from 'commander'
import { printError } from '#sim-cli/output/io'
import { embedStore, setSoftExitCode } from '../../embed-context'
import {
  SOURCE_LOCKED_EXIT_CODE,
  SOURCE_STALE_EXIT_CODE,
  SOURCE_TOO_LARGE_EXIT_CODE,
} from '../../exit-codes'
import type {
  ApplyWorkflowSourceBody,
  ApplyWorkflowSourceResponse,
  CreateWorkflowFromSourceBody,
} from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand, type OperationClient } from '../../runtime/called-operations'
import { printProtocolResult } from './result'
import { writeSourceDirectory, writeSourceScaffold } from './workflow-source-get'
import {
  SOURCE_BASE_FILE as BASE_FILE,
  inBatches,
  SOURCE_LOCK_FILE as LOCK_FILE,
  lockCodeFiles,
  readPreviousLock,
  readSourceText,
  sourceRelativePath,
  writeBack,
} from './workflow-source-layout'

/**
 * One pass over the entry file that matches, in order of precedence, a comment, a
 * `codeFile(<literal>)` call and any other string or template literal. Comments and other
 * literals are matched only so that a `codeFile(` inside them is skipped: a commented-out or
 * quoted reference names no file the source uses. The path is a quoted string or a template
 * literal without `${`, the forms the compiler reads as a constant path.
 */
const ENTRY_TOKENS =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|\bcodeFile\(\s*(?:'([^'\n]*)'|"([^"\n]*)"|`((?:[^`$]|\$(?!\{))*)`)\s*\)|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\[\s\S])*`/g

/** The only files an apply sends beside the entry: function code in a language a block runs. */
const CODE_FILE_EXTENSION = new RegExp(`\\.(?:${Object.values(CODE_FILE_EXTENSIONS).join('|')})$`)

/** The exit status of a refused write a script can branch on; any other refusal exits 1. */
const REFUSAL_EXIT_CODES: Readonly<Record<number, number>> = {
  413: SOURCE_TOO_LARGE_EXIT_CODE,
  423: SOURCE_LOCKED_EXIT_CODE,
}

const EXIT_CODES_HELP = `
Exit codes: 0 applied (or a clean dry run); 1 the source has errors (each printed as
file:line:column with its frame and hint), a create whose workflow name is taken
(SOURCE_NAME_TAKEN: pass --name), or the command failed; 5 the workflow changed since the
directory was read (SOURCE_STALE, on a dry run too: get it again, reapply the edit, retry);
6 the workflow is locked; 7 the source is too large.`

type SourceApplyData = ApplyWorkflowSourceResponse['data']
type Diagnostic = SourceApplyData['diagnostics'][number]

/**
 * The exit status of a dry run that found errors, matching the status a commit's refusal maps to:
 * 7 when a size limit refused the source (a commit answers `413`), 5 when the workflow changed
 * since the directory was read (a commit answers `409 SOURCE_STALE`), else 1.
 */
function refusedExitCode(diagnostics: Diagnostic[]): number {
  const codes = new Set(
    diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.code)
  )
  if (codes.has('E_LIMIT_EXCEEDED')) return SOURCE_TOO_LARGE_EXIT_CODE
  if (codes.has('E_APPLY_STALE')) return SOURCE_STALE_EXIT_CODE
  return 1
}
type SourceLock = ApplyWorkflowSourceBody['lock']
type SourceBase = ApplyWorkflowSourceBody['base']

interface SourceWriteOptions {
  dir: string
  dryRun?: boolean
  yes?: boolean
}

/** The text of a file the directory must hold, or a refusal that says how to write it. */
async function requireText(directory: string, path: string, hint: string): Promise<string> {
  const text = await readSourceText(directory, path)
  if (text === null) throw new SimApiError(`${directory} has no ${path}. ${hint}`, 0)
  return text
}

async function readJson(directory: string, path: string, hint: string): Promise<unknown> {
  const text = await requireText(directory, path, hint)
  try {
    return JSON.parse(text)
  } catch {
    throw new SimApiError(`${path} in ${directory} is not valid JSON. ${hint}`, 0)
  }
}

/**
 * The function-code files the source can reference: every `codeFile(…)` in the entry file's code
 * plus every `codeFile` the lock records, limited to `.js`, `.py` and `.sh` files inside the
 * directory. Only those are sent, so a reference to any other file never uploads it; the server
 * reports a referenced file that is missing or of another kind.
 */
function codeFilePaths(entry: string, lock: SourceLock | null): string[] {
  const candidates = lockCodeFiles(lock)
  for (const match of entry.matchAll(ENTRY_TOKENS)) {
    const literal = match[1] ?? match[2] ?? match[3]
    const path = literal === undefined ? null : sourceRelativePath(literal)
    if (path) candidates.add(path)
  }
  return [...candidates].filter((path) => CODE_FILE_EXTENSION.test(path))
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const where =
    diagnostic.file !== undefined
      ? `${diagnostic.file}:${diagnostic.line ?? 1}:${diagnostic.column ?? 1} `
      : diagnostic.path !== undefined
        ? `${LOCK_FILE}#${diagnostic.path} `
        : ''
  const lines = [`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`]
  if (diagnostic.frame) lines.push(diagnostic.frame)
  if (diagnostic.hint) lines.push(`  hint: ${diagnostic.hint}`)
  return lines.join('\n')
}

/**
 * Prints a write's findings: every error and warning with its location, frame and hint, and each
 * info code folded into one line (a new workflow places every block by autolayout, which is no
 * reason to print a frame per block and bury the warnings).
 */
function printDiagnostics(diagnostics: Diagnostic[]): void {
  const infos = new Map<string, Diagnostic[]>()
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'info') {
      printError(formatDiagnostic(diagnostic))
      continue
    }
    const group = infos.get(diagnostic.code)
    if (group) group.push(diagnostic)
    else infos.set(diagnostic.code, [diagnostic])
  }
  for (const [code, group] of infos) {
    const [first] = group
    printError(
      group.length === 1
        ? formatDiagnostic({ ...first, frame: undefined })
        : `info ${code} on ${group.length} blocks: ${first.message} (and ${group.length - 1} more like it)`
    )
  }
}

/** Prints the notes a write carries (a name the source changed but the apply kept, a dropped tool). */
function printNotes(data: SourceApplyData): void {
  for (const note of data.notes) printError(`note: ${note}`)
}

function isDiagnosticList(value: unknown): value is Diagnostic[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'object' && item !== null && 'code' in item)
  )
}

/** One line naming what the apply changes, shown before asking to confirm it. */
function diffSummary(data: SourceApplyData): string {
  const { blocks, edges, variables } = data.diff
  if (data.diff.noop) return 'No graph changes (names, order or comments may still be saved).'
  const parts = [
    `${blocks.added.length} added`,
    `${blocks.removed.length} removed`,
    `${blocks.renamed.length} renamed`,
    `${blocks.modified.length} modified`,
  ]
  const variableCount =
    variables.added.length + variables.removed.length + variables.modified.length
  const modified = blocks.modified.map(({ key, fields }) => `${key} (${fields.join(', ')})`)
  return `Blocks: ${parts.join(', ')}. Connections: +${edges.added} -${edges.removed}.${
    variableCount > 0 ? ` Variables changed: ${variableCount}.` : ''
  }${modified.length > 0 ? `\nModified: ${modified.join('; ')}` : ''}`
}

/** Whether a person is at a terminal to answer a prompt: never for an embedded run. */
function canPrompt(): boolean {
  return !embedStore.getStore() && process.stdin.isTTY === true && process.stderr.isTTY === true
}

async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = (await prompt.question(`${question} (y/N) `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    prompt.close()
  }
}

const GET_HINT = 'Write the directory with `sim workflows source get` first.'

/**
 * The base an apply sends, refused when it is not this workflow's: a directory written for one
 * workflow and applied to another would replace that workflow's draft with a stranger's source.
 */
async function readBase(directory: string, workflowId: string): Promise<SourceBase> {
  const base = await readJson(directory, BASE_FILE, GET_HINT)
  if (!isRecordLike(base) || typeof base.fingerprint !== 'string') {
    throw new SimApiError(`${BASE_FILE} in ${directory} has no fingerprint. ${GET_HINT}`, 0)
  }
  if (base.workflowId !== workflowId) {
    throw new SimApiError(
      typeof base.workflowId === 'string'
        ? `${directory} holds the source of workflow ${base.workflowId}, not ${workflowId}. Apply it to ${base.workflowId}, or write this workflow's source with \`sim workflows source get ${workflowId} --dir <dir>\`.`
        : `${BASE_FILE} in ${directory} names no workflow. ${GET_HINT}`,
      0,
      'SOURCE_WORKFLOW_MISMATCH'
    )
  }
  return base as SourceBase
}

/**
 * The files a write sends: the entry file and the code files it or the lock references. A
 * referenced file that is missing is left out, and the server reports it with its source line.
 */
async function readSourceFiles(
  directory: string,
  lock: SourceLock | null
): Promise<Record<string, string>> {
  const entry = await requireText(directory, ENTRY_FILE, GET_HINT)
  const files: Record<string, string> = { [ENTRY_FILE]: entry }
  const paths = codeFilePaths(entry, lock)
  const texts = await inBatches(paths, (path) => readSourceText(directory, path))
  paths.forEach((path, index) => {
    const text = texts[index]
    if (text !== null) files[path] = text
  })
  return files
}

/**
 * The exit status of a refused write. A `409` is stale only when the server says so
 * (`SOURCE_STALE`): a name another workflow holds (`SOURCE_NAME_TAKEN`) or any other conflict
 * cannot be fixed by reading the workflow again, so it exits 1.
 */
function refusalExitCode(error: SimApiError, detailCode: unknown): number {
  if (error.status === 409) return detailCode === 'SOURCE_STALE' ? SOURCE_STALE_EXIT_CODE : 1
  return REFUSAL_EXIT_CODES[error.status] ?? error.exitCode
}

/**
 * Re-throws an API refusal after printing its diagnostics, so each shows its source line, with
 * the exit status a script branches on.
 */
function printRefusal(error: unknown): never {
  if (!(error instanceof SimApiError)) throw error
  const details = toRecord(error.details)
  const diagnostics = details.diagnostics
  const printed = isDiagnosticList(diagnostics)
  if (printed) printDiagnostics(diagnostics)
  const nameTaken = error.status === 409 && details.code === 'SOURCE_NAME_TAKEN'
  throw new SimApiError(
    nameTaken
      ? `${error.message} Pass --name to create it under another name, or apply to that workflow.`
      : error.message,
    error.status,
    error.code,
    printed ? undefined : error.details,
    refusalExitCode(error, details.code),
    error.requestId
  )
}

type SourceWriteOperation = 'applyWorkflowSource' | 'createWorkflowFromSource'

/**
 * The shared write flow of `apply` and `create`: refuse a write without consent when no terminal
 * can ask, preview and ask on a terminal, send, print the diagnostics, and after a successful
 * write save the re-printed files, the lock and the base back into the directory, pruning the
 * function files the new lock no longer names.
 */
async function runSourceWrite<Operation extends SourceWriteOperation>(args: {
  directory: string
  options: SourceWriteOptions
  creating: boolean
  question: string
  /** The lock the directory held before the write: the record of the files the CLI wrote. */
  previousLock: unknown
  client: OperationClient<Operation>
  operation: Operation
  params: Record<string, string>
  body: ApplyWorkflowSourceBody | CreateWorkflowFromSourceBody
  output: Parameters<typeof printProtocolResult>[0]
  /** Saves a successful write into the directory; by default the files, lock and base. */
  save?: (data: SourceApplyData) => Promise<void>
}): Promise<void> {
  const { directory, options, creating } = args
  /** Sends the write (or its dry run); a refusal prints its diagnostics and rethrows. */
  const send = async (dryRun: boolean): Promise<SourceApplyData> => {
    try {
      const response = await args.client.request<ApplyWorkflowSourceResponse>(args.operation, {
        params: args.params,
        ...(dryRun ? { query: { dryRun: true } } : {}),
        body: args.body,
      })
      return response.data
    } catch (error) {
      return printRefusal(error)
    }
  }
  if (!options.dryRun && !options.yes) {
    const preview = await send(true)
    printDiagnostics(preview.diagnostics)
    printNotes(preview)
    if (preview.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      setSoftExitCode(refusedExitCode(preview.diagnostics))
      printProtocolResult(args.output, summarize(preview, creating))
      return
    }
    printError(diffSummary(preview))
    if (!(await confirm(args.question))) {
      throw new SimApiError('Nothing was applied.', 0, 'CANCELLED')
    }
  }

  const data = await send(options.dryRun === true)
  printDiagnostics(data.diagnostics)
  printNotes(data)
  const refused = data.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  if (refused) setSoftExitCode(refusedExitCode(data.diagnostics))

  if (!data.dryRun && !refused && (data.applied || !creating)) {
    if (args.save) await args.save(data)
    else await writeBack(directory, data, args.previousLock)
  }

  printProtocolResult(args.output, summarize(data, creating))
}

/** A write without `--yes` or `--dry-run` where no terminal can ask: the generic refusal. */
function requireConsent(options: SourceWriteOptions, action: string): void {
  if (!options.dryRun && !options.yes && !canPrompt()) {
    throw new SimApiError(
      `This ${action}. Re-run with --yes to apply it, or with --dry-run to check it without writing.`,
      0,
      'CONFIRMATION_REQUIRED'
    )
  }
}

const DIR_DESCRIPTION =
  'Source directory: workflow.ts, functions/*, .sim/lock.json and .sim/base.json'

/**
 * `sim workflows source apply <workflowId> --dir <dir>`: sends a source directory written by
 * `workflows source get` (`workflow.ts`, its function-code files, `.sim/lock.json` and
 * `.sim/base.json`) and, after a successful write, saves the re-printed files, the new lock and
 * the new base back into it, so the next apply starts from what was stored.
 *
 * Writing needs consent: on a terminal it shows the dry-run outcome and asks; anywhere else it
 * needs `--yes`. `--dry-run` writes nothing, so it never asks.
 */
export function attachWorkflowSourceApply(source: Command): void {
  const [command, connectApply] = apiCommand(source, 'apply', ['applyWorkflowSource'])
  command
    .argument('<workflowId>', 'Workflow whose draft the source replaces')
    .requiredOption('--dir <dir>', DIR_DESCRIPTION)
    .option('--dry-run', 'Check the source and show the outcome without saving or writing files')
    .option('-y, --yes', 'Apply without asking for confirmation')
    .allowExcessArguments(false)
    .description('Apply a workflow source directory to a workflow draft')
    .addHelpText('after', EXIT_CODES_HELP)
    .action(async (workflowId: string, options: SourceWriteOptions) => {
      requireConsent(options, 'writes the workflow draft')
      const { client, profile } = connectApply()
      const lock = (await readJson(options.dir, LOCK_FILE, GET_HINT)) as SourceLock
      const base = await readBase(options.dir, workflowId)
      const files = await readSourceFiles(options.dir, lock)
      await runSourceWrite({
        directory: options.dir,
        options,
        creating: false,
        question: `Apply these changes to workflow ${workflowId}?`,
        previousLock: lock,
        output: profile.output,
        client,
        operation: 'applyWorkflowSource',
        params: { workflowId },
        body: { files, lock, base, provenance: { client: 'cli' } },
      })
    })
}

/**
 * `sim workflows source create --dir <dir>`: creates a workflow from the directory's
 * `workflow.ts`, then writes what `get --dir` would have: the new workflow's re-printed files, its
 * lock files, the SDK declarations, `tsconfig.json` and the agent guide, so the directory is ready
 * for the edit loop. Same consent rule as `apply`.
 */
export function attachWorkflowSourceCreate(source: Command): void {
  const [command, connectCreate] = apiCommand(source, 'create', [
    'createWorkflowFromSource',
    'getSourceCatalog',
    'getSourceResources',
  ])
  command
    .requiredOption(
      '--dir <dir>',
      'Source directory: workflow.ts and functions/*. Without workflow.ts, writes a starter and the types instead (an error with --dry-run or --yes)'
    )
    .option('--dry-run', 'Check the source and show the outcome without creating anything')
    .option('--name <name>', "The workflow name (default: the source's)")
    .option('--folder <path>', 'The folder to create it in (default: the root)')
    .option('-y, --yes', 'Create without asking for confirmation')
    .allowExcessArguments(false)
    .description('Create a workflow from a workflow source directory')
    .addHelpText('after', EXIT_CODES_HELP)
    .action(async (options: SourceWriteOptions & { name?: string; folder?: string }) => {
      if ((await readSourceText(options.dir, ENTRY_FILE)) === null) {
        if (options.dryRun || options.yes) {
          throw new SimApiError(
            `${options.dir} has no ${ENTRY_FILE}, so there is nothing to ${options.dryRun ? 'check' : 'create'}. Write ${ENTRY_FILE} there, or run \`sim workflows source create --dir ${options.dir}\` without --dry-run and --yes to write a starter.`,
            0
          )
        }
        const { client, profile } = connectCreate()
        const tree = await writeSourceScaffold(client, options.dir, client.requireWorkspace())
        printError(
          `${options.dir} had no ${ENTRY_FILE}, so a starter, the SDK types, tsconfig.json, .sim/AGENTS.md and .sim/examples/cookbook.ts were written and nothing was created. Edit ${ENTRY_FILE}, then run \`sim workflows source create --dir ${options.dir} --yes\`.`
        )
        printProtocolResult(profile.output, { created: false, scaffolded: true, ...tree })
        return
      }
      requireConsent(options, 'creates a workflow')
      const { client, profile } = connectCreate()
      const workspaceId = client.requireWorkspace()
      const files = await readSourceFiles(options.dir, null)
      const previousLock = await readPreviousLock(options.dir)
      await runSourceWrite<'createWorkflowFromSource'>({
        directory: options.dir,
        options,
        creating: true,
        question: 'Create this workflow?',
        previousLock,
        output: profile.output,
        client,
        operation: 'createWorkflowFromSource',
        params: { workspaceId },
        save: async (data) => {
          await writeSourceDirectory(client, options.dir, data, [])
        },
        body: {
          files,
          ...(options.name !== undefined ? { name: options.name } : {}),
          ...(options.folder !== undefined ? { folderPath: options.folder } : {}),
          provenance: { client: 'cli' },
        },
      })
    })
}

/** A create that did not apply stored nothing, so its provisional workflow id names no workflow. */
function summarize(data: SourceApplyData, created: boolean) {
  return {
    ...(created && !data.applied ? {} : { workflowId: data.workflowId }),
    ...(created ? { created: data.applied } : {}),
    applied: data.applied,
    dryRun: data.dryRun,
    noop: data.diff.noop,
    blocksAdded: data.diff.blocks.added.length,
    blocksRemoved: data.diff.blocks.removed.length,
    blocksModified: data.diff.blocks.modified.length,
    ...(data.diff.blocks.modified.length > 0 && {
      modified: data.diff.blocks.modified.map(({ key, fields }) => ({ block: key, fields })),
    }),
    edgesAdded: data.diff.edges.added,
    edgesRemoved: data.diff.edges.removed,
    errors: data.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warnings:
      data.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length +
      data.notes.length,
    fingerprint: data.base.fingerprint,
    needsRedeployment: data.needsRedeployment,
  }
}
