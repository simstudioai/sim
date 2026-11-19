/**
 * What `status` and `diff` print, shared by `workflows source` and `workspaces source`: the status
 * report (local changes, drift, conflicts, the dry run's plan and the one next command), its exit
 * status, the unified diff of each changed file, and the rule for when the server counts as
 * unreachable, so both commands degrade to the local view the same way.
 */

import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FileChange, SourceStatus } from '@sim/workspace-code/status'
import { createTwoFilesPatch, FILE_HEADERS_ONLY } from 'diff'
import type { OutputFormat } from '../../config/index'
import {
  AUTH_REQUIRED_CODE,
  SOURCE_DRIFT_EXIT_CODE,
  SOURCE_LOCAL_CHANGES_EXIT_CODE,
  SOURCE_TOO_LARGE_EXIT_CODE,
} from '../../exit-codes'
import { noAnswer, SimApiError } from '../../http/client'
import { printLine } from '../../output/io'
import { styles } from '../../output/presentation'
import { bytes, printDocument, sanitize } from '../../output/render'

/** Whether the server was asked: `checked`, `unreachable` (degraded to local), or `offline`. */
export type ServerCheck = 'checked' | 'unreachable' | 'offline'

/** The next command a status recommends, and why. */
export interface NextStep {
  command: string
  reason: string
}

/** What `status --output json` prints; `plan` is the command's own dry-run summary. */
export interface StatusReport<Plan> extends SourceStatus {
  dir: string
  server: ServerCheck
  /** Why the server was not checked, or what it left unchecked. */
  note?: string
  plan: Plan | null
  next: NextStep | null
}

/** The status exit codes, each documented in the commands' help. */
export const STATUS_EXIT_CODES_HELP = `
Exit codes: 0 clean (nothing to apply, and the server changed nothing since the directory was
read); ${SOURCE_LOCAL_CHANGES_EXIT_CODE} local changes only (applying writes them); ${SOURCE_DRIFT_EXIT_CODE} the server changed since the
directory was read: drift (a resource edited, added or deleted there that the directory leaves
alone) or a conflict (also changed here, so applying it is refused as stale), with or without
local changes; ${SOURCE_TOO_LARGE_EXIT_CODE} the source is too large for the server to read in one dry run; 1 the command
failed. A server that cannot be reached is not a failure: the status shows the local changes only
and says so (exit 0 or ${SOURCE_LOCAL_CHANGES_EXIT_CODE}).`

/** What `diff` compares, and its exit codes. */
export const DIFF_HELP = `
Without --server, each file created, edited or deleted since the directory was read is shown
against the text it was read at. The CLI records only each file's digest, so that text is the
server's current text where it still matches the digest; a file the server changed since is
named instead (compare it with --server). A binary file is shown by its sizes. Paths filter by
file or folder (and in a workspace directory by kind:key, such as table:leads). Exit codes: 0 the
differences were shown, whether or not there were any; ${SOURCE_TOO_LARGE_EXIT_CODE} the source is too large for the server
to read; 1 the command failed.`

/** The exit status of a status report: drift or conflict, else local changes, else clean. */
export function statusExitCode(state: SourceStatus['state']): number {
  if (state === 'conflict' || state === 'drift') return SOURCE_DRIFT_EXIT_CODE
  return state === 'local' ? SOURCE_LOCAL_CHANGES_EXIT_CODE : 0
}

/** Gateway statuses that mean the server was not reached, rather than that it refused. */
const UNREACHABLE_STATUSES = new Set([502, 503, 504])

/**
 * Why the server could not be reached (no connection, a timeout, a gateway that gave up, no login
 * on the profile), as a sentence, or `null` for any other failure (a cancelled request included),
 * which a status reports rather than hides.
 */
export function unreachableReason(error: unknown): string | null {
  if (!(error instanceof SimApiError)) return null
  const offline =
    noAnswer(error, UNREACHABLE_STATUSES) ||
    (error.status === 0 && error.code === AUTH_REQUIRED_CODE)
  if (!offline) return null
  return /[.!?]$/.test(error.message) ? error.message : `${error.message}.`
}

/**
 * The login a status recommends when `error` is the CLI's own refusal of a profile with no login
 * (which a status treats as an unreachable server), or `null` for any other failure.
 */
export function loginCommand(error: unknown, authProfile: string): string | null {
  return error instanceof SimApiError && error.status === 0 && error.code === AUTH_REQUIRED_CODE
    ? `sim login --profile ${authProfile}`
    : null
}

const SERVER_WORDS = {
  changed: 'changed on the server',
  deleted: 'deleted on the server',
  moved: 'moved on the server',
  added: 'added on the server',
} as const

/**
 * Prints a status: the machine shape for `json` and `yaml`, else one screen naming each local
 * change, each drifted and conflicting resource, the dry run's summary line and the next command.
 */
export function printStatusReport<Plan>(
  format: OutputFormat,
  heading: string,
  report: StatusReport<Plan>,
  planLine: (plan: Plan) => string
): void {
  if (format === 'json' || format === 'yaml') {
    printDocument(format, report)
    return
  }
  const s = styles()
  const lines = [s.bold(sanitize(heading))]
  if (report.local.length === 0) lines.push('No local changes.')
  else {
    lines.push(
      `Local changes (${report.local.reduce((sum, entry) => sum + entry.files.length, 0)} files):`
    )
    for (const entry of report.local) {
      const files = entry.files.map(
        (file) => `${file.path}${file.change === entry.change ? '' : ` (${file.change})`}`
      )
      lines.push(
        `  ${entry.change.padEnd(8)} ${entry.kind} ${sanitize(entry.key)}: ${sanitize(files.join(', '))}`
      )
    }
  }
  if (report.server === 'checked') {
    if (report.drift.length === 0 && report.conflicts.length === 0) {
      lines.push('The server changed nothing this directory read.')
    }
    if (report.drift.length > 0) {
      lines.push(s.yellow('Changed on the server since the directory was read:'))
      for (const entry of report.drift) {
        lines.push(`  ${entry.kind} ${sanitize(entry.key)}: ${SERVER_WORDS[entry.server]}`)
      }
    }
    if (report.conflicts.length > 0) {
      lines.push(s.red('Conflicts (changed on both sides; applying them is refused):'))
      for (const entry of report.conflicts) {
        lines.push(
          `  ${entry.kind} ${sanitize(entry.key)}: ${SERVER_WORDS[entry.server]}, ${entry.change} here`
        )
      }
    }
  } else {
    lines.push(s.yellow(`Server not checked${report.note ? `: ${sanitize(report.note)}` : '.'}`))
  }
  if (report.server === 'checked' && report.note) lines.push(s.dim(sanitize(report.note)))
  if (report.plan) lines.push(planLine(report.plan))
  if (report.next) {
    lines.push(`Next: ${s.bold(report.next.command)}`)
    lines.push(s.dim(`  ${report.next.reason}`))
  }
  printLine(lines.join('\n'))
}

/** One file's difference, as `diff --output json` prints it. */
export interface FileDiff {
  path: string
  change: FileChange
  /** A binary file: its sizes instead of a patch (`null` when not known). */
  binary?: { before: number | null; after: number | null }
  /** The unified diff, without the `Index:` header. */
  patch?: string
  /** Why the file's other side could not be read, instead of a patch. */
  unavailable?: string
}

/** What `diff --output json` prints. */
export interface DiffReport {
  dir: string
  /** `base`: local against what the directory was read at; `server`: against the server now. */
  against: 'base' | 'server'
  /** Why the server, which holds the base text, could not be reached. */
  unreachable?: string
  files: FileDiff[]
}

/**
 * A changed file whose base text is not at hand: the CLI records only digests, so the base text
 * is the server's current text where it still matches the record, and here the server either
 * could not be reached (`unreachable`) or changed the file since.
 */
export function baseUnavailable(
  file: { path: string; change: FileChange },
  unreachable: string | null
): FileDiff {
  return {
    path: file.path,
    change: file.change,
    unavailable:
      unreachable !== null
        ? 'its base text is read from the server, which could not be reached'
        : 'the server changed it since the directory was read, so its base text is gone; compare with --server',
  }
}

/**
 * The unified diff of one text file (`null` for a missing side: a created or deleted file), as a
 * list holding it, or an empty list when the two are the same.
 */
export function textDiff(
  path: string,
  before: string | null,
  after: string | null,
  against: DiffReport['against']
): FileDiff[] {
  if (before === after) return []
  const change: FileChange = before === null ? 'created' : after === null ? 'deleted' : 'edited'
  const patch = createTwoFilesPatch(
    before === null ? '/dev/null' : `${against}/${path}`,
    after === null ? '/dev/null' : `local/${path}`,
    before ?? '',
    after ?? '',
    undefined,
    undefined,
    { context: 3, headerOptions: FILE_HEADERS_ONLY }
  )
  return [{ path, change, patch }]
}

/** Colors one patch line the way `git diff` does: headers bold, hunks cyan, `-` red, `+` green. */
function colorLine(line: string): string {
  const s = styles()
  if (line.startsWith('---') || line.startsWith('+++')) return s.bold(line)
  if (line.startsWith('@@')) return s.cyan(line)
  if (line.startsWith('-')) return s.red(line)
  if (line.startsWith('+')) return s.green(line)
  return line
}

/**
 * Prints a diff: the machine shape for `json` and `yaml`, else each file's unified diff (colored
 * when stdout is a terminal), a binary file's sizes, and the reason a file's other side is
 * unavailable.
 */
export function printDiffReport(format: OutputFormat, report: DiffReport): void {
  if (format === 'json' || format === 'yaml') {
    printDocument(format, report)
    return
  }
  const s = styles()
  const lines: string[] = []
  if (report.unreachable) {
    lines.push(s.yellow(`Server not checked: ${sanitize(report.unreachable)}`))
  }
  if (report.files.length === 0) {
    lines.push(report.against === 'base' ? 'No local changes.' : 'No differences from the server.')
  }
  for (const file of report.files) {
    if (file.binary) {
      const size = (value: number | null) => (value === null ? 'unknown size' : bytes(value))
      lines.push(
        s.bold(
          `Binary ${sanitize(file.path)} ${file.change}: ${size(file.binary.before)} -> ${size(file.binary.after)}`
        )
      )
    } else if (file.unavailable) {
      lines.push(s.bold(`${sanitize(file.path)} ${file.change}: ${sanitize(file.unavailable)}`))
    } else if (file.patch) {
      lines.push(...sanitize(file.patch).trimEnd().split('\n').map(colorLine))
    }
  }
  printLine(lines.join('\n'))
}

/** The paths a `diff [paths...]` names. */
export interface PathFilter {
  /** Whether `path` (relative to the directory) is selected: every path when no filter is given. */
  selects(path: string): boolean
  /**
   * Refuses, naming each filter that selects none of `paths` (every path the comparison could
   * show), so a mistyped filter is an error rather than "No local changes."
   */
  assertEachMatches(paths: Iterable<string>): void
}

/**
 * `path` with symlinks resolved (`/var` is `/private/var` on macOS), through its nearest existing
 * ancestor when it does not exist (a deleted file).
 */
function realPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(realPath(parent), basename(path))
  }
}

/**
 * The directory-relative forms of one filter: as given (`./` and a trailing `/` dropped, an empty
 * one meaning the whole directory) and resolved from the current directory, so both
 * `diff --dir wf workflow.ts` and `diff --dir wf wf/workflow.ts` (or an absolute path) name it.
 * A path outside `dir` has no resolved form.
 */
function filterForms(filter: string, dir: string): string[] {
  const forms = new Set<string>()
  if (!isAbsolute(filter)) {
    const given = filter
      .replace(/\\/g, '/')
      .replace(/^(\.\/)+/, '')
      .replace(/\/+$/, '')
    forms.add(given === '' ? '.' : given)
  }
  const resolved = relative(realPath(resolve(dir)), realPath(resolve(filter)))
    .split(sep)
    .join('/')
  if (resolved === '') forms.add('.')
  else if (resolved !== '..' && !resolved.startsWith('../') && !isAbsolute(resolved)) {
    forms.add(resolved)
  }
  return [...forms]
}

/**
 * The filter of `filters` against `dir`: a filter selects the path it names, every path under a
 * folder it names, or (as `kind:key` given to `keyOf`) every file of that resource.
 */
export function pathFilter(
  filters: readonly string[],
  dir: string,
  keyOf: (path: string) => string | null = () => null
): PathFilter {
  const each = filters.map((filter) => ({ filter, forms: filterForms(filter, dir) }))
  const matches = (forms: readonly string[], path: string) => {
    const key = keyOf(path)
    return forms.some(
      (form) => form === '.' || form === path || path.startsWith(`${form}/`) || form === key
    )
  }
  return {
    selects: (path) => each.length === 0 || each.some(({ forms }) => matches(forms, path)),
    assertEachMatches(paths) {
      if (each.length === 0) return
      const unmatched = new Set(each.map(({ filter }) => filter))
      for (const path of paths) {
        for (const { filter, forms } of each) {
          if (unmatched.has(filter) && matches(forms, path)) unmatched.delete(filter)
        }
        if (unmatched.size === 0) return
      }
      throw new SimApiError(
        `${[...unmatched].map((filter) => `"${sanitize(filter)}"`).join(', ')} selects no file in ${sanitize(dir)}; name a file or folder relative to --dir, or a path from the current directory inside it.`,
        0,
        'SOURCE_PATH_UNMATCHED'
      )
    },
  }
}

/** What the next command depends on beyond the status itself. */
interface NextStepInput {
  /** `sim workspaces source` or `sim workflows source`. */
  prefix: string
  dir: string
  /** What `get` takes before `--dir` (a workflow id), with its trailing space. */
  getArgs: string
  server: ServerCheck
  /** Errors in the dry run, server changes left out. */
  errors: number
  /**
   * Whether the dry run deletes anything (a resource, or data an update drops), which applying
   * needs `--allow-delete` for.
   */
  deletes: boolean
  /**
   * Arguments every recommended command carries after `--dir`, each with a leading space: the
   * scope the status was asked for (`--only`, `--workspace`), so the command acts on what it showed.
   */
  scope: string
  /**
   * The login command when the server was not checked because the profile has no login: nothing
   * else can be decided until it runs.
   */
  login?: string | null
}

/**
 * The one command a status recommends: get into a fresh directory on a conflict, get into this
 * one when the server drifted and nothing here is unapplied, the dry run when the server was not
 * checked or the changes have errors, else apply. `null` when there is nothing to do.
 */
export function nextStep(status: SourceStatus, input: NextStepInput): NextStep | null {
  const { prefix, dir } = input
  if (input.login) {
    return {
      command: input.login,
      reason: `This profile is not logged in, so the server was not checked: log in, then run \`${prefix} status --dir ${dir}\` again.`,
    }
  }
  if (status.conflicts.length > 0) {
    const names = status.conflicts.map((entry) => `${entry.kind} ${entry.key}`).join(', ')
    return {
      command: `${prefix} get ${input.getArgs}--dir <fresh dir>${input.scope}`,
      reason: `${names} changed on both sides, so applying is refused: get into a fresh directory and reapply your edits there (\`${prefix} diff --dir ${dir} --server\` shows how the server differs).`,
    }
  }
  if (status.local.length === 0) {
    return status.drift.length > 0
      ? {
          command: `${prefix} get ${input.getArgs}--dir ${dir}${input.scope}`,
          reason: 'Nothing here is unapplied, so a get brings the directory up to date.',
        }
      : null
  }
  if (input.server !== 'checked') {
    return {
      command: `${prefix} apply --dir ${dir} --dry-run${input.scope}`,
      reason: 'The dry run checks the changes against the server.',
    }
  }
  if (input.errors > 0) {
    return {
      command: `${prefix} apply --dir ${dir} --dry-run${input.scope}`,
      reason: `It prints the ${input.errors} error(s) to fix before applying.`,
    }
  }
  return {
    command: `${prefix} apply --dir ${dir} --yes${input.deletes ? ' --allow-delete' : ''}${input.scope}`,
    reason:
      status.drift.length > 0
        ? `Applies your changes; then \`${prefix} get ${input.getArgs}--dir ${dir}\` picks up the server's.`
        : 'Applies your changes.',
  }
}
