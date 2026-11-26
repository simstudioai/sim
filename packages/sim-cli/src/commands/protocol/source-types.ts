/**
 * The type check `sim workflows source check` and `sim workspaces source check` run after the
 * compile: the pinned TypeScript release (`SOURCE_TYPESCRIPT_VERSION`, the one the generated
 * declarations are built for) over the directory's `tsconfig.json`, each error a finding.
 *
 * A source directory has no `package.json`, so the release is installed once with `npm` into the
 * CLI's cache and reused from there, unless {@link TYPESCRIPT_DIR_ENV} names a directory that
 * already holds it. When it cannot be installed (offline, no `npm`) or does not start, the check
 * reports `W_TYPES_UNCHECKED` and the compile's findings still decide the exit.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { codeFrame } from '@sim/workflow-code'
import { SOURCE_TYPESCRIPT_VERSION } from '@sim/workflow-sdk/codegen'
import type { Command } from 'commander'
import { configDir } from '../../config/paths'
import { embedStore } from '../../embed-context'
import { childProcessEnv } from '../../environment'
import { printError } from '../../output/io'
import {
  digest,
  FILE_CONCURRENCY,
  readSourceText,
  readWritten,
  SOURCE_CACHE_DIR,
  SOURCE_CACHE_IGNORE,
  updateSourceDir,
  type Written,
} from './source-dir'
import { keptTableColumns, TSCONFIG_FILE, WORKSPACE_TYPES_FILE } from './source-tree'
import { type Diagnostic, shellWord } from './source-ui'

/** The `--types` / `--no-types` pair: absent runs the type check. */
export interface TypesOptions {
  types?: boolean
}

/** What both check commands' help says of the type check. */
export const TYPES_HELP = `Then it type-checks the directory with TypeScript ${SOURCE_TYPESCRIPT_VERSION} (the release the
declarations are built for) over tsconfig.json. Each type error is an E_TYPE error, its message
starting with TypeScript's code. One is left out on a line the compile already reports an error
on, and in a file still as the last get or apply wrote it when that file had the same error then
(against the declarations as that get or apply left them). The first check installs that release
with npm into the CLI's cache, once (none when SIM_TYPESCRIPT_DIR already holds it); when it
cannot (offline, no npm), the check warns W_TYPES_UNCHECKED and passes or fails on the compile
alone. --no-types skips the type check.`

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

/**
 * Names a directory of TypeScript releases installed ahead of time, one per version as the cache
 * lays them out (`<dir>/<version>/node_modules/typescript`), such as a sandbox image bakes in
 * with `npm install --prefix <dir>/<version> typescript@<version>`. A check reads the pinned
 * release there before the cache and never writes there; without it, the cache installs as usual.
 */
const TYPESCRIPT_DIR_ENV = 'SIM_TYPESCRIPT_DIR'

/** The pinned release's folder in `releases`, a directory laid out one folder per version. */
function releaseRoot(releases: string): string {
  return join(releases, SOURCE_TYPESCRIPT_VERSION)
}

/** Where the pinned release is installed: cache, safe to delete, so it follows `SIM_CONFIG_DIR`. */
function typescriptRoot(): string {
  return releaseRoot(join(configDir(), 'cache', 'typescript'))
}

function tscPath(root: string): string {
  return join(root, 'node_modules', 'typescript', 'bin', 'tsc')
}

interface Finished {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  /** Whether stdout passed {@link MAX_OUTPUT_BYTES} and the rest was left out. */
  stdoutCut: boolean
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
    const output = { stdout: '', stderr: '', stdoutCut: false }
    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream]?.setEncoding('utf8').on('data', (chunk: string) => {
        if (output[stream].length < MAX_OUTPUT_BYTES) output[stream] += chunk
        else if (stream === 'stdout') output.stdoutCut = true
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
 * The pinned release's `tsc`: the one {@link TYPESCRIPT_DIR_ENV} holds, else the cache's, installed
 * on first use into a fresh folder beside its place, then renamed there, so a check interrupted
 * mid-install or two checks installing at once never leave a partial install behind. The install
 * reads the person's npm configuration (registry, proxy).
 */
async function installedTsc(): Promise<string> {
  const preinstalled = process.env[TYPESCRIPT_DIR_ENV]?.trim()
  if (preinstalled) {
    const tsc = tscPath(releaseRoot(preinstalled))
    if (existsSync(tsc)) return tsc
  }
  const root = typescriptRoot()
  const tsc = tscPath(root)
  if (existsSync(tsc)) return tsc
  try {
    await installTypescript(root)
  } catch (error) {
    if (error instanceof TypesUnavailable) throw error
    // The cache folder could not be written (permissions, a full disk).
    throw new TypesUnavailable(
      `TypeScript could not be installed into ${root} (${getErrorMessage(error)}).`
    )
  }
  return tsc
}

/** Installs the pinned release into `root` (see {@link installedTsc}). */
async function installTypescript(root: string): Promise<void> {
  const tsc = tscPath(root)
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
  const project: Array<{ message: string }> = []
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
      project.push(last)
    } else if (last && /^\s/.test(line) && line.trim()) {
      last.message += ` ${line.trim()}`
    }
  }
  return { located, project: project.map(({ message }) => message) }
}

/** The type check's outcome: whether it ran, and its findings. */
export interface TypeCheck {
  checked: boolean
  findings: Diagnostic[]
}

/**
 * Runs the pinned tsc over `root`'s `tsconfig.json` (or `project`, a config under `root`) and
 * returns its errors, each file relative to `root`; a {@link TypesUnavailable} when it cannot be
 * installed, does not start, or stops without saying why.
 */
async function tscErrors(root: string, project = '.'): Promise<ReturnType<typeof parseTscOutput>> {
  const tsc = await installedTsc()
  const finished = await run(
    'TypeScript',
    process.execPath,
    // --noEmit: a tsconfig.json the person wrote may emit, and a check writes nothing.
    [tsc, '-p', project, '--pretty', 'false', '--noEmit'],
    {
      cwd: root,
    }
  )
  // Output past the cap ends mid-line: parse whole lines only, and say what was left out, as an
  // error no filter drops, so a cut list never reads as a clean check.
  const errors = parseTscOutput(
    finished.stdoutCut
      ? finished.stdout.slice(0, finished.stdout.lastIndexOf('\n'))
      : finished.stdout
  )
  if (finished.stdoutCut) {
    errors.project.push(
      'TypeScript reported more errors than a check lists; fix these and check again to see the rest.'
    )
  }
  if (finished.code !== 0 && errors.located.length === 0 && errors.project.length === 0) {
    const said = (finished.stderr || finished.stdout).trim().split('\n')[0] ?? ''
    throw new TypesUnavailable(
      `TypeScript stopped (${finished.signal ?? `exit ${finished.code}`})${said ? `: ${said}` : '.'}`
    )
  }
  return errors
}

/** An error's identity across two runs over the same file text. */
function errorKey({ file, line, column, message }: LocatedTscError): string {
  return `${file}:${line}:${column}:${message}`
}

/**
 * The errors tsc reports with `workspace.d.ts` replaced by `types` (`null`: none), as `root`'s
 * `tsconfig.json` otherwise reads the directory: a config extending it, and `types`, are written
 * for the run into the cache folder, which ignores itself. That folder sits as deep as the SDK
 * folder, so the file's imports of the directory's declarations (`../../tables/<key>`) resolve.
 */
async function errorsWithWorkspaceTypes(
  root: string,
  types: string | null
): Promise<LocatedTscError[]> {
  const id = generateShortId()
  const typesFile = `${SOURCE_CACHE_DIR}/workspace-${id}.d.ts`
  const project = `${SOURCE_CACHE_DIR}/tsconfig-${id}.json`
  const fromCache = (path: string) => posix.relative(SOURCE_CACHE_DIR, path)
  const typesFiles = types === null ? [] : [[typesFile, types] as const]
  const tsconfig = {
    extends: fromCache(TSCONFIG_FILE),
    exclude: [fromCache(WORKSPACE_TYPES_FILE)],
    files: typesFiles.map(([path]) => fromCache(path)),
  }
  const written = [project, ...typesFiles.map(([path]) => path)]
  await updateSourceDir(root, {
    write: [
      SOURCE_CACHE_IGNORE,
      [project, `${JSON.stringify(tsconfig, null, 2)}\n`],
      ...typesFiles,
    ],
  })
  try {
    return (await tscErrors(root, project)).located
  } catch (error) {
    // A run that fails says nothing of the earlier errors, so none is taken as one.
    if (error instanceof TypesUnavailable) return []
    throw error
  } finally {
    await updateSourceDir(root, { write: [], remove: written })
  }
}

/**
 * Which of `errors`, each in a file still as the last get or apply wrote it, that file already had
 * then: all of them when the declarations are as that get or apply left them, else those a second
 * run against `writtenTypes` (`workspace.d.ts` as it was) reports too. A workflow file depends on
 * the declarations alone, never on another workflow file, so an error of an unchanged file that
 * the edited declarations alone cause is kept.
 */
async function errorsAsWritten(
  root: string,
  errors: readonly LocatedTscError[],
  written: Written | null,
  writtenTypes: ((written: Written) => Promise<string | null>) | undefined
): Promise<ReadonlySet<string>> {
  const all = new Set(errors.map(errorKey))
  if (errors.length === 0 || written === null || writtenTypes === undefined) return all
  const [types, current] = await Promise.all([
    writtenTypes(written),
    readSourceText(root, WORKSPACE_TYPES_FILE),
  ])
  if (types === current) return all
  const before = new Set((await errorsWithWorkspaceTypes(root, types)).map(errorKey))
  return new Set([...all].filter((key) => before.has(key)))
}

/**
 * Type-checks the source directory `root` with its `tsconfig.json`, unless `enabled` is false
 * (`--no-types`). `scope` (a folder under `root`, such as `workflows/<key>/`) keeps only that
 * folder's errors, with files relative to it, as a check of one workflow folder of a workspace
 * reports them. Two kinds of type error are left out: one on a line where `compiled` (the
 * compile's findings) already has an error, the same mistake, which the compile says better; and
 * one that a file still as the last get or apply wrote it (`.sim/written.json`) had then: printed
 * source the server accepted, where the declarations can lag (a block the workspace's catalog
 * withholds from the caller while a stored workflow holds it). A workspace directory's check
 * regenerates `workspace.d.ts` from the files, so `writtenTypes` gives the file as that get or
 * apply left it, and an error of an unchanged file is left out only when it occurs against that
 * too; without it the declarations are as written. An embedded run reads files through its host,
 * which no subprocess can, so it does not type-check.
 */
export async function typeCheck(
  root: string,
  options: {
    enabled: boolean
    scope?: string
    compiled: readonly Diagnostic[]
    writtenTypes?: (written: Written) => Promise<string | null>
  }
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
  const asWritten = await errorsAsWritten(
    root,
    located.filter(({ file }) => sources.get(file)?.printed),
    written,
    options.writtenTypes
  )
  const findings: Diagnostic[] = errors.project.map((message) => ({
    code: 'E_TYPE',
    severity: 'error',
    message,
  }))
  for (const error of located) {
    const { file, line, column, message } = error
    const source = sources.get(file)
    if (asWritten.has(errorKey(error))) continue
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

/** tsc's excess-property error: the property, and the object type it is missing from. */
const UNKNOWN_PROPERTY = /^TS2353: .*'([^']+)' does not exist in type '(.*)'\.?$/

/** A member name in a printed object type (`{ body?: …; 'due date': … }`), quoted or bare. */
const TYPE_MEMBER = /(?:^|[{;]\s*)('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*)\??:/g

/** What tsc prints in place of the members a long type leaves out. */
const ELIDED_MEMBERS = /\.\.\. \d+ more \.\.\./

/** The member names of a printed object type, unquoted. */
function typeMembers(printed: string): string[] {
  return [...printed.matchAll(TYPE_MEMBER)].map(([, name]) =>
    /^['"]/.test(name) ? name.slice(1, -1).replace(/\\(.)/g, '$1') : name
  )
}

/**
 * The stored table a row type printed in a type error is, when exactly one fits: its columns are
 * the printed members (or hold them, when tsc elided some) and lack `property`. `null` when none
 * fits, `undefined` when several do.
 */
function tableOfRow(
  tables: ReadonlyMap<string, ReadonlySet<string>>,
  property: string,
  printed: string
): string | null | undefined {
  const members = typeMembers(printed)
  if (members.length === 0) return null
  const elided = ELIDED_MEMBERS.test(printed)
  const fits = [...tables].filter(
    ([, columns]) =>
      !columns.has(property) &&
      (elided || columns.size === members.length) &&
      members.every((member) => columns.has(member))
  )
  if (fits.length === 0) return null
  return fits.length === 1 ? fits[0][0] : undefined
}

/**
 * Adds the refresh to a row write's excess-property type error when the row type is a stored
 * table's as the last get typed it: a column created since (`sim tables columns create`) is
 * missing from those types until a command that reads the server (`source status`) rewrites
 * them, and a check makes no request. The hint names the table only when one table alone fits.
 * Only a workflow directory of its own types tables from the kept manifest: in a workspace
 * directory a table's row type comes from its `tables/<key>.ts`, which the check reads fresh.
 */
export async function withStaleTableHints(
  findings: Diagnostic[],
  dir: string
): Promise<Diagnostic[]> {
  const excess = (finding: Diagnostic) =>
    finding.code === 'E_TYPE' && !finding.hint && UNKNOWN_PROPERTY.test(finding.message)
  if (!findings.some(excess)) return findings
  const tables = await keptTableColumns(dir)
  const refresh = `sim workflows source status --dir ${shellWord(dir)}`
  return findings.map((finding) => {
    const unknown = excess(finding) ? UNKNOWN_PROPERTY.exec(finding.message) : null
    if (!unknown) return finding
    const [, property, printed] = unknown
    const table = tableOfRow(tables, property, printed)
    if (table === null) return finding
    const missing =
      table === undefined
        ? `"${property}" is not a column of the table in the types the last get wrote.`
        : `"${property}" is not a column of table "${table}" in the types the last get wrote.`
    return {
      ...finding,
      hint: `${missing} If it was added since (sim tables columns create), refresh them with \`${refresh}\`, then check again.`,
    }
  })
}
