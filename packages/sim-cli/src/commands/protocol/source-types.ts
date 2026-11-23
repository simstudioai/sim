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
import { getErrorMessage } from '@sim/utils/errors'
import { codeFrame } from '@sim/workflow-code'
import { SOURCE_TYPESCRIPT_VERSION } from '@sim/workflow-sdk/codegen'
import type { Command } from 'commander'
import { configDir } from '../../config/paths'
import { embedStore } from '../../embed-context'
import { printError } from '../../output/io'
import { digest, readSourceText, readWritten } from './source-dir'
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

/** Why the type check could not run, as the `W_TYPES_UNCHECKED` message says it. */
class TypesUnavailable extends Error {}

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

/** Runs `command` to its end, keeping the start of its output; a failure to start rejects. */
function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; shell?: boolean }
): Promise<Finished> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PROCESS_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      windowsHide: true,
    })
    const output = { stdout: '', stderr: '' }
    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream].setEncoding('utf8').on('data', (chunk: string) => {
        if (output[stream].length < MAX_OUTPUT_BYTES) output[stream] += chunk
      })
    }
    child.once('error', reject)
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
  try {
    // A package.json makes the staging folder npm's prefix, so no path is passed on the command
    // line, which a Windows shell would split at a space.
    await writeFile(join(staging, 'package.json'), '{ "private": true }\n')
    printError(`Installing TypeScript ${SOURCE_TYPESCRIPT_VERSION} for the type check, once.`)
    let finished: Finished
    try {
      finished = await run(
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
        { cwd: staging, shell: process.platform === 'win32' }
      )
    } catch (error) {
      throw new TypesUnavailable(`npm could not start (${getErrorMessage(error)}).`)
    }
    if (finished.code !== 0) {
      throw new TypesUnavailable(
        `npm could not install typescript@${SOURCE_TYPESCRIPT_VERSION}: ${npmReason(finished.stderr)}.`
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

/** One error tsc printed: at a file position, or about the project (`tsconfig.json`). */
interface TscError {
  file?: string
  line?: number
  column?: number
  message: string
}

const LOCATED_ERROR = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const PROJECT_ERROR = /^error (TS\d+): (.*)$/

/**
 * The errors of `tsc --pretty false`: one line each, with the indented lines of a message chain
 * (`Types of property 'a' are incompatible.`) joined onto it.
 */
function parseTscOutput(stdout: string): TscError[] {
  const errors: TscError[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const located = LOCATED_ERROR.exec(line)
    if (located) {
      errors.push({
        file: located[1],
        line: Number(located[2]),
        column: Number(located[3]),
        message: `${located[4]}: ${located[5]}`,
      })
      continue
    }
    const project = PROJECT_ERROR.exec(line)
    if (project) {
      errors.push({ message: `${project[1]}: ${project[2]}` })
      continue
    }
    const last = errors.at(-1)
    if (last && /^\s/.test(line) && line.trim()) last.message += ` ${line.trim()}`
  }
  return errors
}

/** The type check's outcome: whether it ran, and its findings. */
export interface TypeCheck {
  checked: boolean
  findings: Diagnostic[]
}

/**
 * Type-checks the source directory `root` with its `tsconfig.json`. `scope` (a folder under
 * `root`, such as `workflows/<key>/`) keeps only that folder's errors, with files relative to it,
 * as a check of one workflow folder of a workspace reports them. Two kinds of type error are left
 * out: one on a line where `compiled` (the compile's findings) already has an error, the same
 * mistake, which the compile says better; and one in a file still as the last get or apply wrote
 * it (`.sim/written.json`), printed source the server accepted, where the declarations can lag
 * (a block the workspace's catalog withholds from the caller while a stored workflow holds it). An embedded run reads files through its host, which no
 * subprocess can, so it does not type-check.
 */
export async function typeCheck(
  root: string,
  options: { scope?: string; compiled: readonly Diagnostic[] }
): Promise<TypeCheck> {
  if (embedStore.getStore()) return { checked: false, findings: [] }
  let finished: Finished
  try {
    const tsc = await installedTsc()
    try {
      finished = await run(process.execPath, [tsc, '-p', '.', '--pretty', 'false'], { cwd: root })
    } catch (error) {
      throw new TypesUnavailable(`TypeScript could not start (${getErrorMessage(error)}).`)
    }
  } catch (error) {
    if (!(error instanceof TypesUnavailable)) throw error
    return {
      checked: false,
      findings: [
        {
          code: 'W_TYPES_UNCHECKED',
          severity: 'warning',
          message: `Types were not checked: ${error.message}`,
          hint: `Run the check once with network access (TypeScript is kept in ${typescriptRoot()}), or pass --no-types.`,
        },
      ],
    }
  }
  const errors = parseTscOutput(finished.stdout)
  if (finished.code !== 0 && errors.length === 0) {
    const said = (finished.stderr || finished.stdout).trim().split('\n')[0] ?? ''
    return {
      checked: false,
      findings: [
        {
          code: 'W_TYPES_UNCHECKED',
          severity: 'warning',
          message: `Types were not checked: TypeScript stopped (${finished.signal ?? `exit ${finished.code}`})${said ? `: ${said}` : '.'}`,
          hint: 'Pass --no-types to skip the type check.',
        },
      ],
    }
  }
  const compiledErrorLines = new Set(
    options.compiled
      .filter((finding) => finding.severity === 'error' && finding.file !== undefined)
      .map((finding) => `${finding.file}:${finding.line}`)
  )
  const written = (await readWritten(root)).digests
  const texts = new Map<string, Promise<string | null>>()
  const findings: Diagnostic[] = []
  for (const error of errors) {
    if (error.file === undefined) {
      findings.push({ code: 'E_TYPE', severity: 'error', message: error.message })
      continue
    }
    const { scope } = options
    if (scope !== undefined && !error.file.startsWith(scope)) continue
    const file = scope === undefined ? error.file : error.file.slice(scope.length)
    if (compiledErrorLines.has(`${file}:${error.line}`)) continue
    let text = texts.get(error.file)
    if (!text) {
      text = readSourceText(root, error.file)
      texts.set(error.file, text)
    }
    const source = await text
    if (source !== null && written[error.file] === digest(source)) continue
    const line = error.line ?? 1
    const column = error.column ?? 1
    findings.push({
      code: 'E_TYPE',
      severity: 'error',
      message: error.message,
      file,
      line,
      column,
      ...(source === null ? {} : { frame: codeFrame(source, { line, column }) }),
    })
  }
  return { checked: true, findings }
}
