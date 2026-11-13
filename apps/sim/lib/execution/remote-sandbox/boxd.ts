import type { Boxd, ExecStream, FsEntry, Machine } from '@boxd-sh/sdk'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import {
  IMMUTABLE_BOXD_SNAPSHOT_REF_ERROR,
  parseBoxdSnapshotRef,
} from '@sim/utils/sandbox-references'
import { env } from '@/lib/core/config/env'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  isNonRetryableExecutionError,
  SandboxLaunchIndeterminateError,
} from '@/lib/execution/non-retryable-error'
import { processCodeFailure } from '@/lib/execution/remote-sandbox/code-failure'
import {
  appendStreamedSandboxOutput,
  isSandboxOutputLimitError,
  MAX_SANDBOX_OUTPUT_BYTES,
  MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
  SandboxOutputFileError,
  SandboxOutputLimitError,
  SandboxProcessOutputBudget,
  tailStreamedSandboxOutput,
} from '@/lib/execution/remote-sandbox/output-limits'
import { resolveSandboxDirectoryEntryPath } from '@/lib/execution/remote-sandbox/paths'
import type {
  CreateSandboxOptions,
  RunCommandOptions,
  SandboxCodeResult,
  SandboxCommandResult,
  SandboxDirectoryEntry,
  SandboxHandle,
  SandboxKind,
  SandboxProvider,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('BoxdSandboxProvider')
const BOXD_DEFAULT_SANDBOX_LIFETIME_MS = 24 * 60 * 60 * 1000
const BOXD_READY_TIMEOUT_MS = 120_000
const BOXD_DEFAULT_NAME_PREFIX = 'sim-sandbox-'
const MACHINE_NAME_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** boxd arms a machine's wall-clock delete timer in whole seconds. */
export function resolveBoxdSandboxLifetimeMs(lifetimeMs: number): number {
  return Math.max(1, Math.ceil(lifetimeMs / 1000)) * 1000
}

const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function assertSafeProcessEnvironment(envs: Record<string, string> | undefined): void {
  for (const [name, value] of Object.entries(envs ?? {})) {
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
      throw new Error(
        'Sandbox environment variable names must start with a letter or underscore and contain only letters, numbers, and underscores'
      )
    }
    if (value.includes('\0')) {
      throw new Error('Sandbox environment variable values may not contain null bytes')
    }
  }
}

function abortError(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Execution cancelled', 'AbortError')
}

/**
 * Resolves the snapshot reference for a sandbox kind. Mirrors the Daytona
 * provider: every kind fails closed when its snapshot is unset, and only the
 * Function base may be displaced by a workspace image.
 */
function snapshotFor(kind: SandboxKind, imageRef?: string): string {
  if (kind === 'mothership') {
    const snapshot = env.BOXD_SHELL_SNAPSHOT?.trim()
    if (!snapshot) {
      throw new Error('Mothership sandbox not configured (BOXD_SHELL_SNAPSHOT is unset)')
    }
    return snapshot
  }
  if (imageRef && (kind === 'code' || kind === 'shell')) {
    return imageRef
  }
  const varName =
    kind === 'doc'
      ? 'BOXD_DOC_SNAPSHOT'
      : kind === 'pi'
        ? 'BOXD_PI_SNAPSHOT'
        : 'BOXD_FUNCTION_SNAPSHOT'
  const snapshot = (
    kind === 'doc'
      ? env.BOXD_DOC_SNAPSHOT
      : kind === 'pi'
        ? env.BOXD_PI_SNAPSHOT
        : env.BOXD_FUNCTION_SNAPSHOT
  )?.trim()
  if (!snapshot) {
    throw new Error(`boxd sandbox not configured (${varName} is unset)`)
  }
  if (kind !== 'doc' && kind !== 'pi' && !parseBoxdSnapshotRef(snapshot)?.version) {
    throw new Error(`boxd sandbox not configured (${varName} ${IMMUTABLE_BOXD_SNAPSHOT_REF_ERROR})`)
  }
  return snapshot
}

/** boxd machine names are DNS labels, so the random suffix stays lowercase alphanumeric. */
function machineName(): string {
  const prefix = env.BOXD_SANDBOX_NAME_PREFIX?.trim() || BOXD_DEFAULT_NAME_PREFIX
  return `${prefix}${generateShortId(10, MACHINE_NAME_ALPHABET)}`
}

/**
 * A pinned reference (`<snapshot>@<version>`) only counts when the machine boots
 * from exactly that version. boxd keeps one version per snapshot name, so a
 * re-saved snapshot must fail the create rather than run code in an image
 * nobody verified.
 */
function assertPinnedSource(machine: Machine, ref: { snapshot: string; version?: number }): void {
  if (ref.version === undefined) return
  const source = machine.source
  const matchesSnapshot =
    source?.kind === 'snapshot' && (source.name === ref.snapshot || source.id === ref.snapshot)
  if (!matchesSnapshot || source?.version !== ref.version) {
    throw new Error(
      `boxd snapshot ${ref.snapshot} is at version ${source?.version ?? 'unknown'}, but this deployment is pinned to version ${ref.version}. Build and verify a new snapshot, then update the pin.`
    )
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error
    ? error.name === 'NotFoundError' || error.name === 'MachineFileNotFoundError'
    : false
}

let sharedClient: { apiKey: string; region: string | undefined; boxd: Boxd } | undefined

/**
 * Every client owns a gRPC channel that stays connected after its last call, so
 * a client per sandbox would hold one connection per execution. One client
 * serves every sandbox; a changed key or region replaces it.
 */
async function boxdClient(apiKey: string, region: string | undefined): Promise<Boxd> {
  if (sharedClient?.apiKey !== apiKey || sharedClient.region !== region) {
    const { Boxd } = await import('@boxd-sh/sdk')
    sharedClient = { apiKey, region, boxd: new Boxd({ apiKey, ...(region ? { region } : {}) }) }
  }
  return sharedClient.boxd
}

/** Quotes a value for a POSIX shell. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

class BoxdSandboxHandle implements SandboxHandle {
  private killed = false
  private killPromise: Promise<void> | null = null

  constructor(
    private readonly boxd: Boxd,
    private readonly machineId: string,
    private readonly language: CodeLanguage
  ) {}

  get sandboxId(): string {
    return this.machineId
  }

  /** Writes the code to a file and runs it with the image's own runtime, like the Daytona adapter. */
  async runCode(
    code: string,
    options: {
      timeoutMs: number
      envs?: Record<string, string>
      javascriptPreload?: string
      maxOutputBytes?: number
      signal?: AbortSignal
    }
  ): Promise<SandboxCodeResult> {
    const runId = generateShortId(12)
    const isPython = this.language === CodeLanguage.Python
    const codePath = `.sim-function-${runId}.${isPython ? 'py' : 'mjs'}`
    const preloadPath = `.sim-function-${runId}.cjs`
    const launchPath = `.sim-function-${runId}.sh`

    try {
      await this.writeFile(codePath, code)
      if (!isPython) {
        const preload = ['global.require = require', options.javascriptPreload]
          .filter(Boolean)
          .join('\n')
        await this.writeFile(preloadPath, `${preload}\n`)
        await this.writeFile(
          launchPath,
          'set -e\nif [ -n "$SIM_NODE_MODULES_PATH" ] && [ ! -e node_modules ]; then ln -s "$SIM_NODE_MODULES_PATH" node_modules; fi\nnode --require "$SIM_PRELOAD_PATH" "$SIM_CODE_PATH" < /dev/null\n'
        )
      }

      const result = await this.runStreamingCommand(
        isPython ? 'python3 "$SIM_CODE_PATH"' : 'bash "$SIM_LAUNCH_PATH"',
        {
          timeoutMs: options.timeoutMs,
          maxOutputBytes: options.maxOutputBytes,
          signal: options.signal,
          atMostOnce: true,
          envs: {
            ...options.envs,
            SIM_CODE_PATH: codePath,
            ...(!isPython
              ? {
                  SIM_NODE_MODULES_PATH: options.envs?.NODE_PATH ?? '',
                  SIM_PRELOAD_PATH: `./${preloadPath}`,
                  SIM_LAUNCH_PATH: launchPath,
                }
              : {}),
          },
        },
        'code'
      )

      if (result.timedOut) {
        return { text: '', stdout: result.stdout, stderr: result.stderr, timedOut: true }
      }
      if (result.exitCode !== 0) {
        return processCodeFailure(result)
      }
      return { text: '', stdout: result.stdout, stderr: result.stderr }
    } finally {
      const scratch = isPython ? [codePath] : [codePath, preloadPath, launchPath]
      await Promise.all(scratch.map((path) => this.removeFile(path).catch(() => {})))
    }
  }

  async runCommand(command: string, options: RunCommandOptions): Promise<SandboxCommandResult> {
    if (!options.atMostOnce) {
      return this.runStreamingCommand(command, options, 'command')
    }

    const commandPath = `/tmp/.sim-command-${generateShortId(12)}.sh`
    try {
      await this.writeFile(commandPath, command)
      return await this.runStreamingCommand(
        'bash "$SIM_COMMAND_PATH"',
        { ...options, envs: { ...options.envs, SIM_COMMAND_PATH: commandPath } },
        'command'
      )
    } finally {
      await this.removeFile(commandPath).catch(() => {})
    }
  }

  /**
   * Runs one command over a single exec stream. The boxd SDK prefixes `env` onto
   * the command line, so the environment is delivered as an owner-only file
   * written through the filesystem API and sourced by the command, as in the
   * Daytona adapter. Values therefore never appear in a command line or the
   * machine's process list, and the file is removed before the command runs.
   * Stdin is closed so a command that reads it ends instead of waiting. Closing
   * the stream on timeout, abort, or an output overflow ends the remote process
   * group.
   */
  private async runStreamingCommand(
    command: string,
    options: RunCommandOptions,
    operation: 'code' | 'command'
  ): Promise<SandboxCommandResult> {
    assertSafeProcessEnvironment(options.envs)
    if (options.signal?.aborted) throw abortError(options.signal)

    let stdout = ''
    let stderr = ''
    const outputBudget = new SandboxProcessOutputBudget(
      options.maxOutputBytes ?? MAX_SANDBOX_PROCESS_OUTPUT_BYTES
    )
    // Matches the other adapters: the budget bounds what Sim retains, so a stream
    // the caller consumes itself keeps only a diagnostic tail.
    const retainStdout = options.onStdout === undefined
    const retainStderr = options.onStderr === undefined
    const finalStdout = () => (retainStdout ? stdout : tailStreamedSandboxOutput(stdout))
    const finalStderr = () => (retainStderr ? stderr : tailStreamedSandboxOutput(stderr))

    const envEntries = Object.entries(options.envs ?? {})
    const envPath = envEntries.length > 0 ? `/tmp/.sim-env-${generateShortId(12)}` : undefined

    let stream: ExecStream | undefined
    let resolveOutputLimit!: () => void
    const outputLimitExceeded = new Promise<'output-limit'>((resolve) => {
      resolveOutputLimit = () => resolve('output-limit')
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    let abortListener: (() => void) | undefined
    try {
      let script = command
      if (envPath) {
        const envFile = envEntries.map(([key, value]) => `${key}=${shellQuote(value)}`).join('\n')
        await this.boxd.machines.fs.write(this.machineId, envPath, Buffer.from(envFile, 'utf-8'), {
          mode: 0o600,
        })
        script = `set -a; . ${envPath}; set +a; rm -f ${envPath}; ${command}`
      }
      if (options.signal?.aborted) throw abortError(options.signal)
      stream = this.boxd.machines.streamExec(this.machineId, {
        command: options.rootUser ? ['sudo', '-n', 'bash', '-c', script] : ['bash', '-c', script],
        closeStdin: true,
      })
      const active = stream

      const pump = async (
        source: AsyncIterable<Uint8Array>,
        retain: boolean,
        append: (chunk: string) => void,
        callback?: (chunk: string) => void
      ): Promise<void> => {
        const decoder = new TextDecoder()
        const accept = (chunk: string) => {
          if (!chunk) return
          if (retain) {
            try {
              outputBudget.add(chunk)
            } catch {
              resolveOutputLimit()
              return
            }
          }
          append(chunk)
          callback?.(chunk)
        }
        for await (const bytes of source) {
          accept(decoder.decode(bytes, { stream: true }))
          if (outputBudget.error) return
        }
        accept(decoder.decode())
      }

      const appendStdout = (chunk: string) => {
        stdout = retainStdout ? stdout + chunk : appendStreamedSandboxOutput(stdout, chunk)
      }
      const appendStderr = (chunk: string) => {
        stderr = retainStderr ? stderr + chunk : appendStreamedSandboxOutput(stderr, chunk)
      }
      let streamError: unknown
      const finished = Promise.all([
        pump(active.stdout, retainStdout, appendStdout, options.onStdout),
        pump(active.stderr, retainStderr, appendStderr, options.onStderr),
        active.wait(),
      ])
        .then(([, , exitCode]) => ({ kind: 'done' as const, exitCode }))
        .catch((error: unknown) => {
          streamError = error
          return { kind: 'error' as const }
        })

      const timedOut = new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), Math.max(0, options.timeoutMs))
      })
      const aborted = new Promise<{ kind: 'aborted' }>((resolve) => {
        abortListener = () => resolve({ kind: 'aborted' })
        options.signal?.addEventListener('abort', abortListener, { once: true })
        if (options.signal?.aborted) abortListener()
      })
      const outcome = await Promise.race([
        finished,
        timedOut,
        aborted,
        outputLimitExceeded.then((kind) => ({ kind })),
      ])

      if (outcome.kind === 'aborted') {
        active.close()
        void this.kill().catch(() => {})
        throw abortError(options.signal)
      }
      if (outcome.kind === 'output-limit' || outputBudget.error) {
        active.close()
        throw outputBudget.error ?? new SandboxOutputLimitError(0, 0, 'process')
      }
      if (outcome.kind === 'timeout') {
        active.close()
        return {
          stdout: finalStdout(),
          stderr: finalStderr() || `Command timed out after ${options.timeoutMs}ms`,
          exitCode: 124,
          timedOut: true,
        }
      }
      if (outcome.kind === 'error') throw streamError
      return { stdout: finalStdout(), stderr: finalStderr(), exitCode: outcome.exitCode }
    } catch (error) {
      stream?.close()
      if (envPath && !stream) void this.removeFile(envPath).catch(() => {})
      if (isSandboxOutputLimitError(error)) {
        void this.kill().catch(() => {})
        throw error
      }
      if (isNonRetryableExecutionError(error)) throw error
      if (options.signal?.aborted) throw abortError(options.signal)
      if (options.atMostOnce) {
        throw new SandboxLaunchIndeterminateError('boxd', { cause: error })
      }
      if (operation === 'code') throw error
      return { stdout: finalStdout(), stderr: finalStderr() || getErrorMessage(error), exitCode: 1 }
    } finally {
      if (timer) clearTimeout(timer)
      if (abortListener) options.signal?.removeEventListener('abort', abortListener)
    }
  }

  async readFile(path: string): Promise<string> {
    const { content } = await this.readFileWithLimit(path, {
      maxBytes: MAX_SANDBOX_OUTPUT_BYTES,
      encoding: 'utf8',
    })
    return content
  }

  async getFileSize(path: string): Promise<number> {
    const entry = await this.boxd.machines.fs.stat(this.machineId, path)
    // A link to a regular file counts as that file, as on the other adapters.
    const type = entry.isSymlink ? entry.targetType : entry.type
    if (type !== 'file') throw new SandboxOutputFileError(path)
    return entry.size
  }

  async readFileWithLimit(
    path: string,
    options: { maxBytes: number; encoding: 'utf8' | 'base64'; signal?: AbortSignal }
  ): Promise<{ content: string; byteLength: number }> {
    const size = await this.getFileSize(path)
    if (size > options.maxBytes) {
      throw new SandboxOutputLimitError(size, options.maxBytes)
    }

    const chunks: Uint8Array[] = []
    let byteLength = 0
    for await (const chunk of this.boxd.machines.fs.readStream(this.machineId, path)) {
      if (options.signal?.aborted) throw abortError(options.signal)
      byteLength += chunk.byteLength
      if (byteLength > options.maxBytes) {
        throw new SandboxOutputLimitError(byteLength, options.maxBytes)
      }
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks, byteLength)
    return {
      content: buffer.toString(options.encoding === 'base64' ? 'base64' : 'utf8'),
      byteLength,
    }
  }

  async writeFile(path: string, content: string | ArrayBuffer): Promise<void> {
    const data =
      typeof content === 'string' ? Buffer.from(content, 'utf-8') : new Uint8Array(content)
    await this.boxd.machines.fs.write(this.machineId, path, data)
  }

  async removeFile(path: string): Promise<void> {
    await this.boxd.machines.fs.remove(this.machineId, path)
  }

  /**
   * Walks the directory breadth first. A symlink is followed and reported as
   * what it points to, matching the other adapters (see the interface's TSDoc).
   */
  async listFiles(path: string, options?: { depth?: number }): Promise<SandboxDirectoryEntry[]> {
    const maxDepth = Math.max(1, options?.depth ?? 1)
    const files: SandboxDirectoryEntry[] = []
    let frontier: string[] = [path]
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const next: string[] = []
      for (const directory of frontier) {
        const entries: FsEntry[] = await this.boxd.machines.fs.list(this.machineId, directory)
        for (const entry of entries) {
          const type = entry.isSymlink ? entry.targetType : entry.type
          if (type !== 'file' && type !== 'directory') continue
          const resolved = resolveSandboxDirectoryEntryPath(path, entry.path)
          if (!resolved) continue
          files.push({
            ...resolved,
            kind: type === 'directory' ? 'directory' : 'file',
            size: entry.size,
          })
          if (type === 'directory') next.push(entry.path)
        }
      }
      frontier = next
    }
    return files
  }

  async kill(): Promise<void> {
    if (this.killed) return
    if (!this.killPromise) {
      this.killPromise = this.boxd.machines
        .delete(this.machineId)
        .catch((error: unknown) => {
          if (!isNotFound(error)) throw error
        })
        .then(() => {
          this.killed = true
        })
        .finally(() => {
          if (!this.killed) this.killPromise = null
        })
    }
    await this.killPromise
  }
}

/**
 * boxd runs each sandbox as an isolated microVM restored from a snapshot.
 *
 * Like Daytona it takes the `runtime` strategy: workspace dependencies are
 * installed inside the sandbox before user code runs, so no per-workspace
 * snapshot has to be built or retained. boxd deletes the machine when its
 * wall-clock lifetime runs out, and `kill()` deletes it as soon as the
 * execution ends.
 */
export const boxdProvider: SandboxProvider = {
  id: 'boxd',
  dependencyStrategy: 'runtime',
  resolveLifetimeMs: resolveBoxdSandboxLifetimeMs,
  async create(kind: SandboxKind, options?: CreateSandboxOptions): Promise<SandboxHandle> {
    const apiKey = env.BOXD_API_KEY
    if (!apiKey) {
      throw new Error('BOXD_API_KEY is required when the boxd sandbox provider is selected')
    }
    const snapshot = snapshotFor(kind, options?.imageRef)
    const ref = parseBoxdSnapshotRef(snapshot)
    if (!ref) {
      throw new Error(`boxd snapshot reference "${snapshot}" is not valid`)
    }
    const language = options?.language ?? CodeLanguage.Python
    const lifetimeSeconds =
      resolveBoxdSandboxLifetimeMs(options?.lifetimeMs ?? BOXD_DEFAULT_SANDBOX_LIFETIME_MS) / 1000
    logger.info('Creating boxd sandbox', { kind, snapshot })

    const org = env.BOXD_ORG?.trim()
    const boxd = await boxdClient(apiKey, env.BOXD_REGION?.trim() || undefined)
    options?.onProviderRequestStarted?.(Date.now())
    const machine = await boxd.machines.create({
      name: machineName(),
      ...(org ? { org } : {}),
      fromSnapshot: ref.snapshot,
      isolated: true,
      labels: { 'sim-sandbox-kind': kind },
      deleteAfter: lifetimeSeconds,
      config: { autoSuspendTimeout: 0 },
    })

    try {
      assertPinnedSource(machine, ref)
      await boxd.machines.waitUntilReady(machine.id, { timeout: BOXD_READY_TIMEOUT_MS })
    } catch (error) {
      await boxd.machines.delete(machine.id).catch((deleteError: unknown) => {
        logger.warn('Failed to delete a boxd sandbox that did not start', {
          sandboxId: machine.id,
          error: getErrorMessage(deleteError),
        })
      })
      throw error
    }

    return new BoxdSandboxHandle(boxd, machine.id, language)
  },
}
