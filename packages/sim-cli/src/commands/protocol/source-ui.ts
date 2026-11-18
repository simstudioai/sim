/**
 * What a source write prints and asks, shared by `workflows source` and `workspaces source`: the
 * findings (each with its location, frame and hint), the confirmation prompt, the refusal of a
 * write nobody confirmed, and an API refusal re-thrown with the exit status a script branches on.
 */
import { createInterface } from 'node:readline/promises'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { printError } from '#sim-cli/output/io'
import { embedStore } from '../../embed-context'
import {
  SOURCE_BUSY_EXIT_CODE,
  SOURCE_LOCKED_EXIT_CODE,
  SOURCE_STALE_EXIT_CODE,
  SOURCE_TOO_LARGE_EXIT_CODE,
} from '../../exit-codes'
import type {
  ApplyWorkflowSourceResponse,
  ApplyWorkspaceSourceResponse,
} from '../../generated/v2-api'
import { SimApiError } from '../../http/client'

/** One finding of a source write, as the workflow and workspace answers both carry it. */
type WorkflowDiagnostic = ApplyWorkflowSourceResponse['data']['diagnostics'][number]

/** A workflow finding, or a workspace one: the same fields, over both code vocabularies. */
type Diagnostic = Omit<WorkflowDiagnostic, 'code'> & {
  code:
    | WorkflowDiagnostic['code']
    | ApplyWorkspaceSourceResponse['data']['diagnostics'][number]['code']
}

/** The exit status of a refused write a script can branch on; any other refusal exits 1. */
const REFUSAL_EXIT_CODES: Readonly<Record<number, number>> = {
  413: SOURCE_TOO_LARGE_EXIT_CODE,
  423: SOURCE_LOCKED_EXIT_CODE,
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const where =
    diagnostic.file !== undefined && diagnostic.path === undefined
      ? `${diagnostic.file}:${diagnostic.line ?? 1}:${diagnostic.column ?? 1} `
      : diagnostic.path !== undefined
        ? `${diagnostic.file ?? SOURCE_LOCK_FILE}#${diagnostic.path} `
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

function findingKey(diagnostic: Diagnostic): string {
  const { code, file, line, column, path, message } = diagnostic
  return JSON.stringify([code, file, line, column, path, message])
}

/** Records `key` in `printed`, returning whether it was new. */
export function fresh(printed: Set<string>, key: string): boolean {
  if (printed.has(key)) return false
  printed.add(key)
  return true
}

/**
 * Prints the findings `printed` does not hold yet and records them, so a finding the preview
 * showed is not shown again by the write that follows it.
 */
export function printNewDiagnostics(diagnostics: Diagnostic[], printed: Set<string>): void {
  printDiagnostics(diagnostics.filter((diagnostic) => fresh(printed, findingKey(diagnostic))))
}

function isDiagnosticList(value: unknown): value is Diagnostic[] {
  return Array.isArray(value) && value.every((item) => isRecordLike(item) && 'code' in item)
}

/** Whether a person is at a terminal to answer a prompt: never for an embedded run. */
function canPrompt(): boolean {
  return !embedStore.getStore() && process.stdin.isTTY === true && process.stderr.isTTY === true
}

/** Asks `question` on the terminal; anything but `y` or `yes` is no. */
export async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = (await prompt.question(`${question} (y/N) `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    prompt.close()
  }
}

/** The exit status of each `409` the server tells apart by `details.code`; any other exits 1. */
const CONFLICT_EXIT_CODES: Readonly<Record<string, number>> = {
  SOURCE_STALE: SOURCE_STALE_EXIT_CODE,
  SOURCE_BUSY: SOURCE_BUSY_EXIT_CODE,
}

/**
 * The exit status of a refused write. A `409` is stale only when the server says so
 * (`SOURCE_STALE`), and busy when another workspace apply is writing (`SOURCE_BUSY`): a name
 * another workflow holds (`SOURCE_NAME_TAKEN`) or any other conflict cannot be fixed by reading
 * the workflow again or waiting, so it exits 1.
 */
function refusalExitCode(error: SimApiError, detailCode: unknown): number {
  if (error.status === 409) {
    return typeof detailCode === 'string' ? (CONFLICT_EXIT_CODES[detailCode] ?? 1) : 1
  }
  return REFUSAL_EXIT_CODES[error.status] ?? error.exitCode
}

/** Statuses a gateway answers when it gave up waiting for the server, which may still write. */
const LOST_ANSWER_STATUSES = new Set([502, 504])

/**
 * Whether a write failed without the server's answer (a timeout, a dropped connection, a gateway
 * that gave up), so it may or may not have been stored.
 */
function answerLost(error: SimApiError): boolean {
  return (error.status === 0 && error.code === null) || LOST_ANSWER_STATUSES.has(error.status)
}

/**
 * Re-throws an API refusal after printing its diagnostics, so each shows its source line, with
 * the exit status a script branches on. `ifAnswerLost` is the next step for a write whose answer
 * never came back, appended to its message.
 */
export function printRefusal(error: unknown, ifAnswerLost?: string): never {
  if (!(error instanceof SimApiError)) throw error
  const details = toRecord(error.details)
  const diagnostics = details.diagnostics
  const printed = isDiagnosticList(diagnostics)
  if (printed) printDiagnostics(diagnostics)
  const nameTaken = error.status === 409 && details.code === 'SOURCE_NAME_TAKEN'
  const hint = nameTaken
    ? 'Pass --name to create it under another name, or apply to that workflow.'
    : ifAnswerLost && answerLost(error)
      ? ifAnswerLost
      : null
  throw new SimApiError(
    hint ? `${error.message} ${hint}` : error.message,
    error.status,
    error.code,
    printed ? undefined : error.details,
    refusalExitCode(error, details.code),
    error.requestId
  )
}

/**
 * A write without `--yes` or `--dry-run` where no terminal can ask: the generic refusal, naming
 * what the write does (`writes the workflow draft`) and its verb (`apply`).
 */
export function requireConsent(
  options: { dryRun?: boolean; yes?: boolean },
  action: string,
  verb: string
): void {
  if (!options.dryRun && !options.yes && !canPrompt()) {
    throw new SimApiError(
      `This ${action}. Re-run with --yes to ${verb} it, or with --dry-run to check it without writing.`,
      0,
      'CONFIRMATION_REQUIRED'
    )
  }
}
