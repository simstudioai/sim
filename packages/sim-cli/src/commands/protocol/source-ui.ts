/**
 * What a source write prints and asks, shared by `workflows source` and `workspaces source`: the
 * findings (each with its location, frame and hint), the confirmation prompt, the refusal of a
 * write nobody confirmed, and an API refusal re-thrown with the exit status a script branches on.
 */
import { isRecordLike, toRecord } from '@sim/utils/object'
import { boundFindingText, type RefusalClass } from '@sim/workflow-code/diagnostics'
import { SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { type FlatDiagnostic, refusalClass } from '@sim/workspace-code'
import type { Command } from 'commander'
import { annotationLine, annotationPath, printAnnotations } from '#sim-cli/output/github-actions'
import { printError } from '#sim-cli/output/io'
import { askLine } from '#sim-cli/terminal/line-input'
import type { OutputFormat } from '../../config/index'
import { embedStore, setSoftExitCode } from '../../embed-context'
import {
  SOURCE_BUSY_EXIT_CODE,
  SOURCE_LOCKED_EXIT_CODE,
  SOURCE_PLANNED_EXIT_CODE,
  SOURCE_STALE_EXIT_CODE,
  SOURCE_TOO_LARGE_EXIT_CODE,
} from '../../exit-codes'
import type {
  ApplyWorkflowSourceResponse,
  ApplyWorkspaceSourceResponse,
} from '../../generated/v2-api'
import { isRequestCancelled, noAnswer, SimApiError } from '../../http/client'
import { LocalRefusal } from './local-errors'

/** One finding of a source write, as the workflow and workspace answers both carry it. */
type WorkflowDiagnostic = ApplyWorkflowSourceResponse['data']['diagnostics'][number]

/** A workflow finding, or a workspace one: the same fields, over both code vocabularies. */
export type Diagnostic = Omit<WorkflowDiagnostic, 'code'> & {
  code:
    | WorkflowDiagnostic['code']
    | ApplyWorkspaceSourceResponse['data']['diagnostics'][number]['code']
}

/** The exit status of a refused write a script can branch on; any other refusal exits 1. */
const REFUSAL_EXIT_CODES: Readonly<Record<number, number>> = {
  413: SOURCE_TOO_LARGE_EXIT_CODE,
  423: SOURCE_LOCKED_EXIT_CODE,
}

/** The exit status of each refusal class, as a commit refused for it maps to it: 5, 6, 7, else 1. */
const REFUSAL_CLASS_EXIT_CODES: Readonly<Record<RefusalClass, number>> = {
  conflict: SOURCE_STALE_EXIT_CODE,
  locked: SOURCE_LOCKED_EXIT_CODE,
  payload_too_large: SOURCE_TOO_LARGE_EXIT_CODE,
  validation: 1,
}

/**
 * The exit status of findings that refuse a write, the same for `workflows source` and
 * `workspaces source` and for a dry run and a commit: the status of their most specific class
 * (`refusalClass`).
 */
export function refusedExitCode(
  diagnostics: ReadonlyArray<Pick<Diagnostic, 'code' | 'severity'>>
): number {
  return REFUSAL_CLASS_EXIT_CODES[
    refusalClass(
      diagnostics.filter((finding) => finding.severity === 'error').map((finding) => finding.code)
    )
  ]
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

/** How many other locations a collapsed line lists before counting the rest. */
const COLLAPSED_LOCATIONS = 8

/** Where a finding sits, as its printed line starts with: `file:line:column`, or empty. */
function locationOf(diagnostic: Diagnostic): string {
  return formatDiagnostic({ ...diagnostic, frame: undefined, hint: undefined })
    .split(` ${diagnostic.severity} `)[0]
    .trim()
}

/**
 * Prints a write's findings on stderr for a person: every error with its location, frame and
 * hint; the first warning of each code the same way, and the rest of that code on one line
 * listing where they are, each with its own message when it differs from the first (one fix
 * usually serves them all, and twenty frames of the same warning buried the errors); each info
 * code folded into one line.
 */
function printDiagnostics(diagnostics: readonly Diagnostic[]): void {
  const groups = new Map<string, Diagnostic[]>()
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') {
      printError(formatDiagnostic(diagnostic))
      continue
    }
    const key = `${diagnostic.severity}:${diagnostic.code}`
    const group = groups.get(key)
    if (group) group.push(diagnostic)
    else groups.set(key, [diagnostic])
  }
  for (const [first, ...rest] of groups.values()) {
    if (first.severity === 'info') {
      printError(
        rest.length === 0
          ? formatDiagnostic({ ...first, frame: undefined })
          : `info ${first.code} on ${rest.length + 1} blocks: ${first.message} (and ${rest.length} more like it)`
      )
      continue
    }
    printError(formatDiagnostic(first))
    if (rest.length === 0) continue
    // A collapsed finding saying something else than the first keeps its words beside its place.
    const listed = rest
      .slice(0, COLLAPSED_LOCATIONS)
      .map((diagnostic) => {
        const location = locationOf(diagnostic)
        if (diagnostic.message === first.message) return location
        return location ? `${location} (${diagnostic.message})` : diagnostic.message
      })
      .filter(Boolean)
    const unlisted = rest.length - listed.length
    printError(
      `  ${rest.length} more ${first.code} like it${listed.length > 0 ? `: ${listed.join(', ')}` : ''}${unlisted > 0 && listed.length > 0 ? `, and ${unlisted} more` : ''}`
    )
  }
}

/** A finding in a source command's `--output json` (or `yaml`) result: the frame stays human-only. */
type ResultDiagnostic = Omit<FlatDiagnostic, 'frame' | 'code'> & { code: Diagnostic['code'] }

/** Whether `format` prints one machine document on stdout rather than lines for a person. */
export function isMachine(format: OutputFormat): boolean {
  return format === 'json' || format === 'yaml'
}

/**
 * The `diagnostics` a source command's result carries in a machine format, so the one document on
 * stdout holds every finding: errors and warnings, and info only with `verbose` (a new workflow
 * places every block by autolayout, which is no finding to act on), except `I_FINDINGS_TRUNCATED`,
 * which says the list is incomplete. A display format prints them on stderr only.
 */
function resultDiagnostics(
  format: OutputFormat,
  diagnostics: readonly Diagnostic[],
  verbose = false
): { diagnostics?: ResultDiagnostic[] } {
  if (!isMachine(format)) return {}
  const hidden = (finding: Diagnostic) =>
    !verbose && finding.severity === 'info' && finding.code !== 'I_FINDINGS_TRUNCATED'
  const hiddenCount = diagnostics.filter(hidden).length
  // The marker counts what the answer left out; the infos hidden here are left out on top of it.
  const marked = (finding: Diagnostic): Diagnostic =>
    finding.code === 'I_FINDINGS_TRUNCATED' && hiddenCount > 0
      ? {
          ...finding,
          message: `${finding.message} ${hiddenCount} info finding${hiddenCount === 1 ? '' : 's'} listed ${hiddenCount === 1 ? 'is' : 'are'} hidden too; pass --verbose to see ${hiddenCount === 1 ? 'it' : 'them'}.`,
        }
      : finding
  return {
    diagnostics: diagnostics
      .filter((finding) => !hidden(finding))
      .map(({ frame: _frame, ...finding }) => marked(finding)),
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
 * Where a source command's findings go, chosen once by its output format, so each is shown once:
 * a display format prints them on stderr as frames (and never in the result), a machine format
 * only in the one document on stdout (and never as frames, which an agent reading both streams
 * read twice).
 */
export interface FindingsOutput {
  /** Whether the result is one machine document on stdout. */
  machine: boolean
  /**
   * Prints the findings not printed yet on stderr in a display format, so a finding the preview
   * showed is not shown again by the write that follows it; nothing in a machine format.
   */
  print(diagnostics: readonly Diagnostic[]): void
  /** The result's `diagnostics` field: see {@link resultDiagnostics}. */
  result(diagnostics: readonly Diagnostic[]): { diagnostics?: ResultDiagnostic[] }
}

/**
 * A finding as a GitHub Actions annotation at its file, line and column (the file relative to the
 * source directory `dir`, when known); none for an info finding.
 */
function findingAnnotation(diagnostic: Diagnostic, dir: string | undefined): string[] {
  if (diagnostic.severity === 'info') return []
  // A finding in a non-source file (`path`, a JSON path into it) has no line to point at.
  const { file } = diagnostic
  const site =
    file !== undefined && diagnostic.path === undefined
      ? {
          file: dir === undefined ? file : annotationPath(dir, file),
          line: diagnostic.line,
          column: diagnostic.column,
        }
      : {}
  const message = diagnostic.hint
    ? `${diagnostic.message} Hint: ${diagnostic.hint}`
    : diagnostic.message
  return [annotationLine(diagnostic.severity, message, { ...site, title: diagnostic.code })]
}

/**
 * Info findings a display format prints only with `--verbose`: they report what the server does
 * for the person (a new block placed by autolayout), so there is nothing to act on.
 */
const QUIET_INFO_CODES: ReadonlySet<Diagnostic['code']> = new Set(['I_MAT_NEEDS_LAYOUT'])

/**
 * The {@link FindingsOutput} of `format`; `verbose` keeps info findings in a machine result, and
 * the {@link QUIET_INFO_CODES} in a display one. In a GitHub Actions step every error and warning
 * is also annotated at its file under the source directory `dir`, whatever the format. It is
 * the CLI's output edge, where each finding's message and hint are cut (`boundFindingText`): a
 * finding an offline check made is as long as its source made it until here.
 */
export function findingsOutput(
  format: OutputFormat,
  verbose = false,
  dir?: string
): FindingsOutput {
  const printed = new Set<string>()
  const machine = isMachine(format)
  return {
    machine,
    print(diagnostics) {
      const unseen = diagnostics
        .filter(
          (diagnostic) =>
            (verbose || !QUIET_INFO_CODES.has(diagnostic.code)) &&
            fresh(printed, findingKey(diagnostic))
        )
        .map((diagnostic) => boundFindingText(diagnostic))
      if (!machine) printDiagnostics(unseen)
      printAnnotations(unseen.flatMap((diagnostic) => findingAnnotation(diagnostic, dir)))
    },
    result: (diagnostics) =>
      resultDiagnostics(
        format,
        diagnostics.map((diagnostic) => boundFindingText(diagnostic)),
        verbose
      ),
  }
}

/** A resource a source write created, as its result lists it; `id` once it is written. */
export interface CreatedResource {
  kind: string
  key?: string
  id?: string
}

/** How many created resources the display line names before counting the rest. */
const NAMED_CREATED = 5

/** The created resources as one line for a person: `workflow (abc), block start (b-1), …`. */
export function createdText(created: readonly CreatedResource[]): string {
  if (created.length === 0) return 'none'
  const named = created.slice(0, NAMED_CREATED).map(({ kind, key, id }) => {
    const label = [kind, key].filter((part) => part !== undefined).join(' ')
    return id === undefined ? label : `${label} (${id})`
  })
  const more = created.length - named.length
  return `${named.join(', ')}${more > 0 ? `, and ${more} more` : ''}`
}

/** Adds `--verbose` to a source command whose result can carry info findings. */
export function verboseFlag(command: Command): Command {
  return command.option(
    '--verbose',
    'Also list the info findings hidden by default: every one with --output json, blocks placed by autolayout in the display'
  )
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
  const answer = (await askLine(`${question} (y/N) `))?.trim().toLowerCase()
  return answer === 'y' || answer === 'yes'
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
 * that gave up, a cancellation), so it may or may not have been stored.
 */
function answerLost(error: SimApiError): boolean {
  if (error instanceof LocalRefusal) return false
  return noAnswer(error, LOST_ANSWER_STATUSES) || isRequestCancelled(error)
}

/**
 * The server's pointer to the findings in the error document (`See details.diagnostics.`): a
 * display format prints them instead, so the sentence names a JSON field the reader never sees.
 */
const DETAILS_REFERENCE = / See details\.diagnostics\.$/

/**
 * Re-throws an API refusal after printing its diagnostics, so each shows its source line, with
 * the exit status a script branches on. In a machine `format` the error document keeps the
 * refusal's details with each finding as a success result carries it ({@link resultDiagnostics});
 * a display format prints the findings once, above the error, and `verbose` keeps info findings in
 * the machine document as it does in a result. `ifAnswerLost` is the next step for a write whose
 * answer never came back, appended to its message.
 */
export function printRefusal(
  error: unknown,
  format: OutputFormat,
  options: { ifAnswerLost?: string; verbose?: boolean } = {}
): never {
  const { ifAnswerLost, verbose = false } = options
  if (!(error instanceof SimApiError)) throw error
  const details = toRecord(error.details)
  const diagnostics = details.diagnostics
  const printed = isDiagnosticList(diagnostics)
  const machine = isMachine(format)
  if (printed && !machine) printDiagnostics(diagnostics)
  const message = machine
    ? error.message
    : error.message.replace(DETAILS_REFERENCE, printed ? ' Each finding is printed above.' : '')
  const nameTaken = error.status === 409 && details.code === 'SOURCE_NAME_TAKEN'
  const hint = nameTaken
    ? 'Pass --name to create it under another name, or apply to that workflow.'
    : ifAnswerLost && answerLost(error)
      ? ifAnswerLost
      : null
  throw new SimApiError(
    hint ? `${message} ${hint}` : message,
    error.status,
    error.code,
    printed ? refusalDetails(format, details, diagnostics, verbose) : error.details,
    refusalExitCode(error, details.code),
    error.requestId
  )
}

/** A printed refusal's details: kept, findings flattened, in a machine format; else dropped. */
function refusalDetails(
  format: OutputFormat,
  details: Record<string, unknown>,
  diagnostics: Diagnostic[],
  verbose: boolean
): Record<string, unknown> | undefined {
  const flattened = resultDiagnostics(format, diagnostics, verbose)
  return flattened.diagnostics ? { ...details, ...flattened } : undefined
}

/**
 * How a source write proceeds: `dry-run` checks only; `write` writes at once (`--yes`); `ask`
 * previews and asks on a terminal; `plan` (no `--yes` and no terminal to ask) previews, prints the
 * plan and stops with {@link SOURCE_PLANNED_EXIT_CODE}, so an agent's edit loop sees the plan
 * without a separate dry run and applies it with `--yes`.
 */
export type WriteMode = 'dry-run' | 'write' | 'ask' | 'plan'

/** The {@link WriteMode} of a write's `--dry-run` and `--yes` flags, here. */
export function writeMode(options: { dryRun?: boolean; yes?: boolean }): WriteMode {
  if (options.dryRun) return 'dry-run'
  if (options.yes) return 'write'
  return canPrompt() ? 'ask' : 'plan'
}

/** `value` as one shell word: as it is when it needs no quoting, else single-quoted. */
export function shellWord(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

/** The next step a `plan` run names: the same write with `--yes`. */
export function planNext(command: string): { command: string; reason: string } {
  return {
    command: `${command} --yes`,
    reason: 'Nothing was written: this is the plan. Run it with --yes to apply it.',
  }
}

/** Marks a `plan` run that found no errors: nothing was written, applying needs `--yes`. */
export function stopAtPlan(): void {
  setSoftExitCode(SOURCE_PLANNED_EXIT_CODE)
}
