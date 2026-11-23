/**
 * The type check `sim workflows source check` and `sim workspaces source check` run after the
 * compile: the pinned TypeScript release (`SOURCE_TYPESCRIPT_VERSION`, the one the generated
 * declarations are built for) over the directory's `tsconfig.json`, each error a finding.
 *
 * A source directory has no `package.json`, so the release is installed once with `npm` into the
 * CLI's cache and reused from there. When it cannot be installed (offline, no `npm`) or does not
 * start, the check reports `W_TYPES_UNCHECKED` and the compile's findings still decide the exit.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { getErrorMessage } from '@sim/utils/errors'
import { codeFrame } from '@sim/workflow-code'
import { SOURCE_TYPESCRIPT_VERSION } from '@sim/workflow-sdk/codegen'
import type { Command } from 'commander'
import { configDir } from '../../config/paths'
import { embedStore } from '../../embed-context'
import { childProcessEnv } from '../../environment'
import { printError } from '../../output/io'
import { digest, FILE_CONCURRENCY, readSourceText, readWritten } from './source-dir'
import type { Diagnostic } from './source-ui'

/** The `--types` / `--no-types` pair: absent runs the type check. */
export interface TypesOptions {
  types?: boolean
}

/** What both check commands' help says of the type check. */
export const TYPES_HELP = `Then it type-checks the directory with TypeScript ${SOURCE_TYPESCRIPT_VERSION} (the release the
declarations are built for) over tsconfig.json. Each type error is an E_TYPE error, its message
starting with TypeScript's code; one on a line the compile already reports an error on, or in a
file still as the last get or apply wrote it, is left out. The first check installs that release
with npm into the CLI's cache, once; when it cannot (offline, no npm), the check warns
W_TYPES_UNCHECKED and passes or fails on the compile alone. --no-types skips the type check.`

/** Adds `--no-types` to a check command. */
export function typesFlag(command: Command): Command {
  return command.option(
    '--no-types',
    `Skip the type check (TypeScript ${SOURCE_TYPESCRIPT_VERSION} over tsconfig.json) that runs after the compile`
  )
}

/** Why the type check could not run: the `W_TYPES_UNCHECKED` message and hint. */
class TypesUnavailable extends Error {
  constructor(
    message: string,
    readonly hint = 'Pass --no-types to skip the type check.'
  ) {
    super(message)
  }
}

/** Neither process should take this long; a hung one (a stalled registry) is cut off. */
const PROCESS_TIMEOUT_MS = 5 * 60_000

/** At most this much of a process's output is kept: tsc's findings, npm's error lines. */
const MAX_OUTPUT_BYTES = 1024 * 1024

/** Where the pinned release is installed: cache, safe to delete, so it follows `SIM_CONFIG_DIR`. */
function typescriptRoot(): string {
  return join(configDir(), 'cache', 'typescript', SOURCE_TYPESCRIPT_VERSION)
}

function tscPath(root: string): string {
  return join(root, 'node_modules', 'typescript', 'bin', 'tsc')
}

interface Finished {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

/**
 * Runs `command` (`label` names it) to its end, keeping the start of its output (`stdout: false`
 * discards it). Neither child gets the Sim API key. A failure to start is a {@link TypesUnavailable}.
 */
function run(
  label: string,
  command: string,
  args: readonly string[],
  options: { cwd: string; shell?: boolean; stdout?: boolean }
): Promise<Finished> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: childProcessEnv(['sim_api_key']),
      shell: options.shell ?? false,
      stdio: ['ignore', options.stdout === false ? 'ignore' : 'pipe', 'pipe'],
      timeout: PROCESS_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      windowsHide: true,
    })
    const output = { stdout: '', stderr: '' }
    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream]?.setEncoding('utf8').on('data', (chunk: string) => {
        if (output[stream].length < MAX_OUTPUT_BYTES) output[stream] += chunk
      })
    }
    child.once('error', (error) =>
      reject(new TypesUnavailable(`${label} could not start (${getErrorMessage(error)}).`))
    )
    child.once('close', (code, signal) => resolve({ code, signal, ...output }))
  })
}

/**
 * What npm said went wrong: its first `npm error` line that is not a bare field (`code`, `errno`,
 * `syscall`) or the pointer to its debug log, such as `request to … failed, reason: getaddrinfo
 * ENOTFOUND registry.npmjs.org`.
 */
function npmReason(stderr: string): string {
  const said = stderr
    .split('\n')
    .map((line) => /^npm (?:error|ERR!) (.*)$/.exec(line.trim())?.[1]?.trim() ?? '')
    .find(
      (line) =>
        line !== '' &&
        !/^(?:code|errno|syscall) \S+$/.test(line) &&
        !line.startsWith('A complete log')
    )
  return said?.replace(/^(?:network |FetchError: )/, '') ?? 'npm printed no reason'
}

/**
 * The pinned release's `tsc`, installed on first use: into a fresh folder beside its place, then
 * renamed there, so a check interrupted mid-install or two checks installing at once never leave
 * a partial install behind. The install reads the person's npm configuration (registry, proxy).
 */
async function installedTsc(): Promise<string> {
  const root = typescriptRoot()
  const tsc = tscPath(root)
  if (existsSync(tsc)) return tsc
  const parent = dirname(root)
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(join(parent, `.${SOURCE_TYPESCRIPT_VERSION}-`))
  const offline = `Run the check once with network access (TypeScript is kept in ${root}), or pass --no-types.`
  try {
    // A package.json makes the staging folder npm's prefix, so no path is passed on the command
    // line, which a Windows shell would split at a space.
    await writeFile(join(staging, 'package.json'), '{ "private": true }\n')
    printError(`Installing TypeScript ${SOURCE_TYPESCRIPT_VERSION} for the type check, once.`)
    const finished = await run(
      'npm',
      'npm',
      [
        'install',
        '--no-save',
        '--no-package-lock',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--update-notifier=false',
        '--prefer-offline',
        '--fetch-retries=0',
        '--fetch-timeout=30000',
        '--loglevel=error',
        `typescript@${SOURCE_TYPESCRIPT_VERSION}`,
      ],
      // npm is a `.cmd` launcher on Windows; every argument above is fixed.
      { cwd: staging, shell: process.platform === 'win32', stdout: false }
    ).catch((error: unknown) => {
      throw error instanceof TypesUnavailable ? new TypesUnavailable(error.message, offline) : error
    })
    if (finished.code !== 0) {
      throw new TypesUnavailable(
        `npm could not install typescript@${SOURCE_TYPESCRIPT_VERSION}: ${npmReason(finished.stderr)}.`,
        offline
      )
    }
    if (!existsSync(tscPath(staging))) {
      throw new TypesUnavailable(
        `npm installed typescript@${SOURCE_TYPESCRIPT_VERSION} without tsc.`
      )
    }
    try {
      await rename(staging, root)
    } catch (error) {
      // Another check installed it first.
      if (!existsSync(tsc)) throw error
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return tsc
}

/** An error tsc printed at a file position. */
interface LocatedTscError {
  file: string
  line: number
  column: number
  message: string
}

const LOCATED_ERROR = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const PROJECT_ERROR = /^error (TS\d+): (.*)$/

/**
 * The errors of `tsc --pretty false`, at a file position or about the project (`tsconfig.json`):
 * one line each, with the indented lines of a message chain (`Types of property 'a' are
 * incompatible.`) joined onto it.
 */
function parseTscOutput(stdout: string): { located: LocatedTscError[]; project: string[] } {
  const located: LocatedTscError[] = []
  const project: string[] = []
  let last: { message: string } | undefined
  for (const line of stdout.split(/\r?\n/)) {
    const at = LOCATED_ERROR.exec(line)
    const global = at ? null : PROJECT_ERROR.exec(line)
    if (at) {
      const error: LocatedTscError = {
        file: at[1],
        line: Number(at[2]),
        column: Number(at[3]),
        message: `${at[4]}: ${at[5]}`,
      }
      located.push(error)
      last = error
    } else if (global) {
      last = { message: `${global[1]}: ${global[2]}` }
      project.push(last.message)
    } else if (last && /^\s/.test(line) && line.trim()) {
      last.message += ` ${line.trim()}`
    }
  }
  return { located, project }
}

/** The type check's outcome: whether it ran, and its findings. */
export interface TypeCheck {
  checked: boolean
  findings: Diagnostic[]
}

/**
 * Runs the pinned tsc over `root`'s `tsconfig.json` and returns its errors; a {@link
 * TypesUnavailable} when it cannot be installed, does not start, or stops without saying why.
 */
async function tscErrors(root: string): Promise<ReturnType<typeof parseTscOutput>> {
  const tsc = await installedTsc()
  const finished = await run(
    'TypeScript',
    process.execPath,
    [tsc, '-p', '.', '--pretty', 'false'],
    {
      cwd: root,
    }
  )
  const errors = parseTscOutput(finished.stdout)
  if (finished.code !== 0 && errors.located.length === 0 && errors.project.length === 0) {
    const said = (finished.stderr || finished.stdout).trim().split('\n')[0] ?? ''
    throw new TypesUnavailable(
      `TypeScript stopped (${finished.signal ?? `exit ${finished.code}`})${said ? `: ${said}` : '.'}`
    )
  }
  return errors
}

/**
 * Type-checks the source directory `root` with its `tsconfig.json`, unless `enabled` is false
 * (`--no-types`). `scope` (a folder under `root`, such as `workflows/<key>/`) keeps only that
 * folder's errors, with files relative to it, as a check of one workflow folder of a workspace
 * reports them. Two kinds of type error are left out: one on a line where `compiled` (the
 * compile's findings) already has an error, the same mistake, which the compile says better; and
 * one in a file still as the last get or apply wrote it (`.sim/written.json`), printed source the
 * server accepted, where the declarations can lag (a block the workspace's catalog withholds from
 * the caller while a stored workflow holds it). An embedded run reads files through its host,
 * which no subprocess can, so it does not type-check.
 */
export async function typeCheck(
  root: string,
  options: { enabled: boolean; scope?: string; compiled: readonly Diagnostic[] }
): Promise<TypeCheck> {
  if (!options.enabled || embedStore.getStore()) return { checked: false, findings: [] }
  let errors: Awaited<ReturnType<typeof tscErrors>>
  try {
    errors = await tscErrors(root)
  } catch (error) {
    if (!(error instanceof TypesUnavailable)) throw error
    return {
      checked: false,
      findings: [
        {
          code: 'W_TYPES_UNCHECKED',
          severity: 'warning',
          message: `Types were not checked: ${error.message}`,
          hint: error.hint,
        },
      ],
    }
  }
  const { scope = '' } = options
  const compiledErrorLines = new Set(
    options.compiled
      .filter((finding) => finding.severity === 'error' && finding.file !== undefined)
      .map((finding) => `${finding.file}:${finding.line}`)
  )
  const located = errors.located.filter(
    ({ file, line }) =>
      file.startsWith(scope) && !compiledErrorLines.has(`${file.slice(scope.length)}:${line}`)
  )
  const files = [...new Set(located.map(({ file }) => file))]
  const [written, texts] = await Promise.all([
    located.length > 0 ? readWritten(root) : null,
    mapWithConcurrency(files, FILE_CONCURRENCY, (file) => readSourceText(root, file)),
  ])
  const sources = new Map(
    files.map((file, index) => {
      const text = texts[index]
      const printed = text !== null && written?.digests[file] === digest(text)
      return [file, { text, printed }] as const
    })
  )
  const findings: Diagnostic[] = errors.project.map((message) => ({
    code: 'E_TYPE',
    severity: 'error',
    message,
  }))
  for (const { file, line, column, message } of located) {
    const source = sources.get(file)
    if (source?.printed) continue
    findings.push({
      code: 'E_TYPE',
      severity: 'error',
      message,
      file: file.slice(scope.length),
      line,
      column,
      ...(source && source.text !== null
        ? { frame: codeFrame(source.text, { line, column }) }
        : {}),
    })
  }
  return { checked: true, findings }
}
