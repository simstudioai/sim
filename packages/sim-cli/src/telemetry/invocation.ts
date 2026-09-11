import type { Command } from 'commander'
import { profileFrom } from '../context'
import { isCi } from '../environment'
import { SimApiError } from '../http/client'
import { CLI_VERSION } from '../version'
import { detectCodingAgent } from './coding-agent'
import { telemetryStatus } from './policy'
import { loadTelemetryState, nextSession, type TelemetryState, writeTelemetryState } from './state'
import {
  builtInIngestTarget,
  type CaptureRequest,
  type IngestTarget,
  sendCapture,
} from './transport'

/**
 * Usage reporting for one CLI invocation: what ran, whether it worked, and
 * how long it took. One event per command, sent after the command finishes.
 *
 * What is sent is the smallest set that answers "how is the CLI used": the
 * command's name, the names of the flags typed, how many positional arguments
 * there were, the exit code, the duration, and the runtime it ran on. What is
 * never sent is anything the user typed — no argument values, flag values,
 * paths, or error messages — matching the policy the Stripe, GitHub, and
 * Supabase CLIs converge on. See {@link CommandEventProperties}.
 */

export const COMMAND_EVENT = 'cli_command_executed'

/** The user-facing name of this reporting, as `$lib` in each event. */
const LIBRARY_NAME = 'sim-cli'

/** The command group that manages reporting is never itself reported. */
const EXCLUDED_ROOT_COMMAND = 'telemetry'

export const USAGE_DATA_DOCS_URL = 'https://docs.sim.ai/cli/usage-data'

/**
 * Printed once, the first time reporting would happen on an interactive
 * terminal, the way the Vercel and Next.js notices are. The run that shows it
 * is not reported, so nothing leaves the machine before the user has read
 * that something will.
 */
export const FIRST_RUN_NOTICE = [
  'Sim collects anonymous usage data to improve the CLI: which commands run, whether',
  'they succeed, and how long they take. Nothing you type is sent.',
  `Learn more: ${USAGE_DATA_DOCS_URL}`,
  'Turn it off: sim telemetry disable',
  '',
].join('\n')

/**
 * The event's properties. Kept in one place so the documentation page can be
 * checked against it and a new property is a deliberate addition here.
 */
export interface CommandEventProperties {
  /** Analytics library conventions: the reporting client and its version. */
  $lib: typeof LIBRARY_NAME
  $lib_version: string
  /** Events are anonymous and must not create a person profile per device. */
  $process_person_profile: false
  /** Commands close in time share a session, so a sequence of commands can be read back. */
  $session_id: string
  /** The command's position within its session. */
  session_sequence: number
  /** The same surface name the server stamps on requests carrying `X-Sim-Client-Info`. */
  surface: 'cli'
  /** The command's path, such as `workflows list` — never its arguments. */
  command: string
  /** The long names of flags that were typed, such as `--output`; never their values. */
  flags: string[]
  /** How many positional arguments were given; never what they were. */
  arg_count: number
  exit_code: number
  /** Time from process start to completion, in milliseconds. */
  duration_ms: number
  /** The failure's class name, such as `SimApiError`; never its message. */
  error_name?: string
  /** The API's machine-readable error code, such as `NOT_FOUND`. */
  error_code?: string
  http_status?: number
  cli_version: string
  node_version: string
  os: string
  arch: string
  /** Whether stdout was a terminal, which separates people from scripts. */
  is_tty: boolean
  is_ci: boolean
  /** The AI coding agent driving this shell, when one could be detected. */
  coding_agent?: string
  /** Whether the profile targets Sim's hosted deployment or a self-hosted one; never the address. */
  endpoint_kind?: 'hosted' | 'self_hosted'
}

export interface InvocationOutcome {
  exitCode: number
  error?: unknown
}

export interface CommandTelemetryOptions {
  env?: NodeJS.ProcessEnv
  ingestTarget?: () => IngestTarget | undefined
  send?: typeof sendCapture
  now?: () => Date
  /** Milliseconds since the process started, for the duration. */
  elapsed?: () => number
  isTty?: boolean
  /** Where the first-run notice goes; stderr, so piped output stays clean. */
  write?: (message: string) => void
  /** Registers the listener that reports when the process ends; the real process by default. */
  onExit?: (listener: (exitCode: number) => void) => void
}

export interface CommandTelemetry {
  /** Installs the hook that records which command is about to run, and the exit listener that reports it. */
  observe(program: Command): void
  /**
   * Reports the recorded command, given how it ended. Idempotent, and a no-op
   * when nothing was recorded: the entrypoint calls it with the failure it
   * explained, and the exit listener calls it for every other way out.
   */
  complete(outcome: InvocationOutcome): void
}

interface RecordedInvocation {
  action: Command
  command: string
  flags: string[]
  argCount: number
  state: TelemetryState
  /** Set when this run printed the first-run notice and is therefore not reported. */
  noticeShown: boolean
}

/** The command's own name and its ancestors', root excluded, in typing order. */
function commandPath(command: Command): string[] {
  const names: string[] = []
  for (let current: Command | null = command; current?.parent; current = current.parent) {
    names.unshift(current.name())
  }
  return names
}

/**
 * The flags typed on the command line, on the leaf and every ancestor, so
 * root globals like `--output` count. Only source `cli`: a value that came
 * from the environment or a default was not something the user typed here.
 */
function typedFlags(command: Command): string[] {
  const flags = new Set<string>()
  for (let current: Command | null = command; current; current = current.parent) {
    for (const option of current.options) {
      if (current.getOptionValueSource(option.attributeName()) !== 'cli') continue
      const name = option.long ?? option.short
      if (name) flags.add(name)
    }
  }
  return [...flags]
}

/** Whether the profile points at Sim's hosted deployment; `undefined` when no profile resolves. */
function endpointKind(command: Command): CommandEventProperties['endpoint_kind'] | undefined {
  try {
    const hostname = new URL(profileFrom(command).endpoint).hostname
    return hostname === 'sim.ai' || hostname.endsWith('.sim.ai') ? 'hosted' : 'self_hosted'
  } catch {
    return undefined
  }
}

function failureProperties(
  error: unknown
): Pick<CommandEventProperties, 'error_name' | 'error_code' | 'http_status'> {
  if (error === undefined) return {}
  if (!(error instanceof Error)) return { error_name: 'unknown' }
  const properties: ReturnType<typeof failureProperties> = { error_name: error.name }
  if (error instanceof SimApiError) {
    if (error.code) properties.error_code = error.code
    if (error.status > 0) properties.http_status = error.status
  }
  return properties
}

const listenForProcessExit = (listener: (exitCode: number) => void): void => {
  process.once('exit', listener)
}

export function createCommandTelemetry(options: CommandTelemetryOptions = {}): CommandTelemetry {
  const env = options.env ?? process.env
  const ingestTarget = options.ingestTarget ?? builtInIngestTarget
  const send = options.send ?? sendCapture
  const now = options.now ?? (() => new Date())
  const elapsed = options.elapsed ?? (() => performance.now())
  const isTty = options.isTty ?? process.stdout.isTTY === true
  const write = options.write ?? ((message: string) => void process.stderr.write(message))
  const onExit = options.onExit ?? listenForProcessExit

  let recorded: RecordedInvocation | undefined

  /**
   * Whether this run could report at all, decided from the environment and the
   * build alone so a run that cannot report never touches the state file.
   */
  function isReportable(state: Pick<TelemetryState, 'enabled'>): boolean {
    return telemetryStatus({ env, state, configured: ingestTarget() !== undefined }).enabled
  }

  /**
   * Shows the notice on the first interactive run that would report, and
   * remembers having done so. Not in CI, where nobody is reading, and not on a
   * redirected terminal, where it would land in a log.
   */
  function showNoticeIfDue(state: TelemetryState): boolean {
    if (state.noticeShownAt || !isTty || isCi(env)) return false
    write(FIRST_RUN_NOTICE)
    writeTelemetryState({ ...state, noticeShownAt: now().toISOString() })
    return true
  }

  function complete(outcome: InvocationOutcome): void {
    const invocation = recorded
    recorded = undefined
    if (!invocation || invocation.noticeShown) return
    const target = ingestTarget()
    if (!target || !isReportable(invocation.state)) return

    const timestamp = now()
    const session = nextSession(invocation.state, timestamp)
    writeTelemetryState({ ...invocation.state, session })

    const properties: CommandEventProperties = {
      $lib: LIBRARY_NAME,
      $lib_version: CLI_VERSION,
      $process_person_profile: false,
      $session_id: session.id,
      session_sequence: session.sequence,
      surface: 'cli',
      command: invocation.command,
      flags: invocation.flags,
      arg_count: invocation.argCount,
      exit_code: outcome.exitCode,
      duration_ms: Math.round(elapsed()),
      ...failureProperties(outcome.error),
      cli_version: CLI_VERSION,
      node_version: process.versions.node,
      os: process.platform,
      arch: process.arch,
      is_tty: isTty,
      is_ci: isCi(env),
    }
    const kind = endpointKind(invocation.action)
    if (kind) properties.endpoint_kind = kind
    const agent = detectCodingAgent(env)
    if (agent) properties.coding_agent = agent

    send(target, {
      api_key: target.key,
      event: COMMAND_EVENT,
      distinct_id: invocation.state.deviceId,
      timestamp: timestamp.toISOString(),
      properties,
    } satisfies CaptureRequest<CommandEventProperties>)
  }

  return {
    observe(program) {
      program.hook('preAction', (_root, action) => {
        const path = commandPath(action)
        if (path[0] === EXCLUDED_ROOT_COMMAND || !isReportable({})) return
        const state = loadTelemetryState()
        if (!isReportable(state)) return
        recorded = {
          action,
          command: path.join(' '),
          flags: typedFlags(action),
          argCount: action.args.length,
          state,
          noticeShown: showNoticeIfDue(state),
        }
      })
      /**
       * Commands end in more ways than one: a handler that calls `process.exit`
       * itself, a `process.exitCode` set on the way out, or the entrypoint's
       * own exit. Reporting from the exit event sees all of them, and the
       * sender is a synchronous spawn, which is what an exit listener allows.
       */
      onExit((exitCode) => complete({ exitCode }))
    },
    complete,
  }
}
