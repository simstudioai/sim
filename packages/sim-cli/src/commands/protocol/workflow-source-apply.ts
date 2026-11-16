import { createInterface } from 'node:readline/promises'
import { isRecordLike } from '@sim/utils/object'
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
import { apiCommand } from '../../runtime/called-operations'
import { printProtocolResult } from './result'
import {
  SOURCE_BASE_FILE as BASE_FILE,
  SOURCE_ENTRY_FILE as ENTRY_FILE,
  SOURCE_LOCK_FILE as LOCK_FILE,
  lockCodeFiles,
  orphanedCodeFiles,
  readPreviousLock,
  readSourceText,
  sourceRelativePath,
  updateSourceDir,
} from './workflow-source-layout'

/** `code: codeFile('./functions/x.js')` in the entry file (the SDK's only code-file form). */
const CODE_FILE_REFERENCE = /\bcodeFile\(\s*(['"])([^'"\n]+)\1\s*\)/g

/** The exit status of a refused write a script can branch on; any other refusal exits 1. */
const REFUSAL_EXIT_CODES: Readonly<Record<number, number>> = {
  409: SOURCE_STALE_EXIT_CODE,
  413: SOURCE_TOO_LARGE_EXIT_CODE,
  423: SOURCE_LOCKED_EXIT_CODE,
}

const EXIT_CODES_HELP = `
Exit codes: 0 applied (or a clean dry run); 1 the source has errors (each printed as
file:line:column with its frame and hint) or the command failed; 5 the workflow changed since
the directory was read (SOURCE_STALE: get it again, reapply the edit, retry); 6 the workflow is
locked; 7 the source is too large.`

type SourceApplyData = ApplyWorkflowSourceResponse['data']
type Diagnostic = SourceApplyData['diagnostics'][number]

/**
 * The exit status of a dry run that found errors, matching the status a commit's refusal maps to:
 * 7 when a size limit refused the source (a commit answers `413`), else 1.
 */
function refusedExitCode(diagnostics: Diagnostic[]): number {
  return diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error' && diagnostic.code === 'E_LIMIT_EXCEEDED'
  )
    ? SOURCE_TOO_LARGE_EXIT_CODE
    : 1
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
 * The function-code files the source can reference: every `codeFile('…')` in the entry file plus
 * every `codeFile` the lock records. Only those are sent; the server reports a referenced file
 * that is missing.
 */
function codeFilePaths(entry: string, lock: SourceLock | null): string[] {
  const paths = lockCodeFiles(lock)
  for (const match of entry.matchAll(CODE_FILE_REFERENCE)) {
    const path = sourceRelativePath(match[2])
    if (path) paths.add(path)
  }
  paths.delete(ENTRY_FILE)
  return [...paths]
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
  return `Blocks: ${parts.join(', ')}. Connections: +${edges.added} -${edges.removed}.${
    variableCount > 0 ? ` Variables changed: ${variableCount}.` : ''
  }`
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
  for (const path of codeFilePaths(entry, lock)) {
    const text = await readSourceText(directory, path)
    if (text !== null) files[path] = text
  }
  return files
}

/**
 * Re-throws an API refusal after printing its diagnostics, so each shows its source line, with
 * the exit status a script branches on.
 */
function printRefusal(error: unknown): never {
  if (!(error instanceof SimApiError)) throw error
  const diagnostics = isRecordLike(error.details) ? error.details.diagnostics : undefined
  const printed = isDiagnosticList(diagnostics)
  if (printed) for (const diagnostic of diagnostics) printError(formatDiagnostic(diagnostic))
  throw new SimApiError(
    error.message,
    error.status,
    error.code,
    printed ? undefined : error.details,
    REFUSAL_EXIT_CODES[error.status] ?? error.exitCode,
    error.requestId
  )
}

/**
 * The shared write flow of `apply` and `create`: refuse a write without consent when no terminal
 * can ask, preview and ask on a terminal, send, print the diagnostics, and after a successful
 * write save the re-printed files, the lock and the base back into the directory, pruning the
 * function files the new lock no longer names.
 */
async function runSourceWrite(args: {
  directory: string
  options: SourceWriteOptions
  creating: boolean
  question: string
  /** The lock the directory held before the write: the record of the files the CLI wrote. */
  previousLock: unknown
  send: (dryRun: boolean) => Promise<SourceApplyData>
  output: Parameters<typeof printProtocolResult>[0]
}): Promise<void> {
  const { directory, options, creating, send } = args
  if (!options.dryRun && !options.yes) {
    const preview = await send(true)
    for (const diagnostic of preview.diagnostics) printError(formatDiagnostic(diagnostic))
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
  for (const diagnostic of data.diagnostics) printError(formatDiagnostic(diagnostic))
  const refused = data.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  if (refused) setSoftExitCode(refusedExitCode(data.diagnostics))

  if (!data.dryRun && !refused && (data.applied || !creating)) {
    const write: Array<[string, string]> = Object.entries(data.files)
    write.push(
      [LOCK_FILE, `${JSON.stringify(data.lock, null, 2)}\n`],
      [BASE_FILE, `${JSON.stringify(data.base, null, 2)}\n`]
    )
    await updateSourceDir(directory, {
      write,
      remove: orphanedCodeFiles(args.previousLock, data.lock, Object.keys(data.files)),
    })
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
        send: async (dryRun) => {
          try {
            const response = await client.request<ApplyWorkflowSourceResponse>(
              'applyWorkflowSource',
              {
                params: { workflowId },
                ...(dryRun ? { query: { dryRun: true } } : {}),
                body: {
                  files,
                  lock,
                  base,
                  provenance: { client: 'cli' },
                } satisfies ApplyWorkflowSourceBody,
              }
            )
            return response.data
          } catch (error) {
            return printRefusal(error)
          }
        },
      })
    })
}

/**
 * `sim workflows source create --dir <dir>`: creates a workflow from the directory's
 * `workflow.ts`, then writes the new workflow's re-printed files and lock files into the
 * directory. Same consent rule as `apply`.
 */
export function attachWorkflowSourceCreate(source: Command): void {
  const [command, connectCreate] = apiCommand(source, 'create', ['createWorkflowFromSource'])
  command
    .requiredOption('--dir <dir>', 'Source directory: workflow.ts and functions/*')
    .option('--dry-run', 'Check the source and show the outcome without creating anything')
    .option('--name <name>', "The workflow name (default: the source's)")
    .option('--folder <path>', 'The folder to create it in (default: the root)')
    .option('-y, --yes', 'Create without asking for confirmation')
    .allowExcessArguments(false)
    .description('Create a workflow from a workflow source directory')
    .addHelpText('after', EXIT_CODES_HELP)
    .action(async (options: SourceWriteOptions & { name?: string; folder?: string }) => {
      requireConsent(options, 'creates a workflow')
      const { client, profile } = connectCreate()
      const workspaceId = client.requireWorkspace()
      const files = await readSourceFiles(options.dir, null)
      const previousLock = await readPreviousLock(options.dir)
      await runSourceWrite({
        directory: options.dir,
        options,
        creating: true,
        question: 'Create this workflow?',
        previousLock,
        output: profile.output,
        send: async (dryRun) => {
          try {
            const response = await client.request<ApplyWorkflowSourceResponse>(
              'createWorkflowFromSource',
              {
                params: { workspaceId },
                ...(dryRun ? { query: { dryRun: true } } : {}),
                body: {
                  files,
                  ...(options.name !== undefined ? { name: options.name } : {}),
                  ...(options.folder !== undefined ? { folderPath: options.folder } : {}),
                  provenance: { client: 'cli' },
                } satisfies CreateWorkflowFromSourceBody,
              }
            )
            return response.data
          } catch (error) {
            return printRefusal(error)
          }
        },
      })
    })
}

function summarize(data: SourceApplyData, created = false) {
  return {
    workflowId: data.workflowId,
    ...(created ? { created: data.applied } : {}),
    applied: data.applied,
    dryRun: data.dryRun,
    noop: data.diff.noop,
    blocksAdded: data.diff.blocks.added.length,
    blocksRemoved: data.diff.blocks.removed.length,
    blocksModified: data.diff.blocks.modified.length,
    edgesAdded: data.diff.edges.added,
    edgesRemoved: data.diff.edges.removed,
    errors: data.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warnings:
      data.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length +
      data.notes.length,
    fingerprint: data.fingerprint,
    needsRedeployment: data.needsRedeployment,
  }
}
