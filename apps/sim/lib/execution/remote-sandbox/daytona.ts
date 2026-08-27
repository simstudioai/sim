import type { CreateSandboxFromSnapshotParams } from '@daytona/sdk'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import {
  IMMUTABLE_DAYTONA_SNAPSHOT_REF_ERROR,
  isImmutableDaytonaSnapshotRef,
} from '@sim/utils/sandbox-references'
import { env } from '@/lib/core/config/env'
import {
  isPayloadSizeLimitError,
  readNodeStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  isNonRetryableExecutionError,
  SandboxLaunchIndeterminateError,
} from '@/lib/execution/non-retryable-error'
import {
  appendStreamedSandboxOutput,
  assertSandboxProcessOutputWithinLimit,
  isSandboxOutputLimitError,
  MAX_SANDBOX_OUTPUT_BYTES,
  MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
  SandboxOutputFileError,
  SandboxOutputLimitError,
  SandboxProcessOutputBudget,
  tailStreamedSandboxOutput,
} from '@/lib/execution/remote-sandbox/output-limits'
import type {
  CreateSandboxOptions,
  RunCommandOptions,
  SandboxCodeResult,
  SandboxCommandResult,
  SandboxHandle,
  SandboxKind,
  SandboxProvider,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('DaytonaSandboxProvider')
const DAYTONA_DEFAULT_SANDBOX_TTL_MS = 24 * 60 * 60 * 1000
const DAYTONA_STREAM_READY_MARKER = '__SIM_DAYTONA_STREAM_READY__'

/** Daytona expresses every timeout in seconds; the rest of Sim works in milliseconds. */
function toSeconds(timeoutMs: number): number {
  return Math.max(1, Math.ceil(timeoutMs / 1000))
}

function isDaytonaExecutionTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false
  return error.name === 'DaytonaTimeoutError' || error.name === 'TimeoutError'
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

function processCodeFailure(result: SandboxCommandResult): SandboxCodeResult {
  const traceback = result.stderr || result.stdout
  const errorLine = traceback
    .split('\n')
    .reverse()
    .find((line) => /^[A-Za-z_$][\w.$]*(?:Error|Exception|Interrupt|Exit)?:\s*/.test(line.trim()))
    ?.trim()
  const separator = errorLine?.indexOf(':') ?? -1
  const parsedErrorLine = errorLine ?? ''
  const name = separator > 0 ? parsedErrorLine.slice(0, separator) : 'Error'
  const value =
    separator > 0
      ? parsedErrorLine.slice(separator + 1).trim()
      : parsedErrorLine || 'Execution failed'
  return {
    text: '',
    stdout: result.stdout,
    stderr: result.stderr,
    error: { name, value, traceback },
  }
}

function snapshotFor(kind: SandboxKind, imageRef?: string): string {
  if (kind === 'mothership') {
    const snapshot = env.DAYTONA_SHELL_SNAPSHOT_ID?.trim()
    if (!snapshot) {
      throw new Error('Mothership sandbox not configured (DAYTONA_SHELL_SNAPSHOT_ID is unset)')
    }
    return snapshot
  }
  // An operator-supplied snapshot may only displace the dedicated Function base.
  // Mothership, doc, and Pi keep their vetted snapshots unconditionally, so
  // nothing a workspace configures can land under those server-owned runtimes.
  if (imageRef && (kind === 'code' || kind === 'shell')) {
    return imageRef
  }
  // Mirrors the E2B provider's fail-closed behaviour: never let LLM-authored code
  // run in a provider default image just because a snapshot id is unset.
  const snapshot =
    kind === 'doc'
      ? env.DAYTONA_DOC_SNAPSHOT_ID
      : kind === 'pi'
        ? env.DAYTONA_PI_SNAPSHOT_ID
        : env.DAYTONA_FUNCTION_SNAPSHOT_ID
  if (!snapshot) {
    const varName =
      kind === 'doc'
        ? 'DAYTONA_DOC_SNAPSHOT_ID'
        : kind === 'pi'
          ? 'DAYTONA_PI_SNAPSHOT_ID'
          : 'DAYTONA_FUNCTION_SNAPSHOT_ID'
    throw new Error(`Daytona sandbox not configured (${varName} is unset)`)
  }
  if (kind !== 'doc' && kind !== 'pi' && !isImmutableDaytonaSnapshotRef(snapshot)) {
    throw new Error(
      `Daytona sandbox not configured (DAYTONA_FUNCTION_SNAPSHOT_ID ${IMMUTABLE_DAYTONA_SNAPSHOT_REF_ERROR})`
    )
  }
  return snapshot
}

/** Daytona binds its code runtime language to the sandbox at creation. */
function toDaytonaLanguage(language: CodeLanguage): string {
  return language === CodeLanguage.Python ? 'python' : 'javascript'
}

class DaytonaSandboxHandle implements SandboxHandle {
  private killed = false
  private killPromise: Promise<void> | null = null

  constructor(
    private readonly sandbox: any,
    private readonly language: CodeLanguage
  ) {}

  get sandboxId(): string {
    return this.sandbox.id
  }

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
    return this.runProcessCode(code, options)
  }

  /**
   * Runs code through Daytona's process stream rather than CodeInterpreter.
   * CodeInterpreter appends output to its result before invoking callbacks and
   * swallows callback exceptions, so it cannot enforce a hard memory bound.
   */
  private async runProcessCode(
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
      await this.sandbox.fs.deleteFile(codePath, false).catch(() => {})
      if (!isPython) {
        await Promise.all([
          this.sandbox.fs.deleteFile(preloadPath, false).catch(() => {}),
          this.sandbox.fs.deleteFile(launchPath, false).catch(() => {}),
        ])
      }
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
        {
          ...options,
          envs: { ...options.envs, SIM_COMMAND_PATH: commandPath },
        },
        'command'
      )
    } finally {
      await this.sandbox.fs.deleteFile(commandPath, false).catch(() => {})
    }
  }

  /**
   * Streaming path (Pi). `SessionExecuteRequest` carries no `env` field, so the
   * environment is delivered as a file written through the filesystem API and
   * sourced by the command. Secrets therefore never appear in a command line or
   * the sandbox process list, and the file is removed before the command runs —
   * preserving the per-command isolation the E2B path provides natively.
   */
  private async runStreamingCommand(
    command: string,
    options: RunCommandOptions,
    operation: 'code' | 'command' = 'command'
  ): Promise<SandboxCommandResult> {
    assertSafeProcessEnvironment(options.envs)
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException('Execution cancelled', 'AbortError')
    }
    const sessionId = `sim-${generateShortId(12)}`
    // Declared outside the try so the catch can return whatever streamed before a
    // failure, rather than blanking the output.
    let stdout = ''
    let stderr = ''
    let sessionCreated = false
    const outputBudget = new SandboxProcessOutputBudget(
      options.maxOutputBytes ?? MAX_SANDBOX_PROCESS_OUTPUT_BYTES
    )
    // Matches the E2B adapter: the budget bounds what Sim retains, so a stream the caller consumes
    // itself is exempt and only a diagnostic tail is kept. Per stream, so a caller that streams
    // stdout but not stderr still has stderr fully bounded. The failover must not change behavior.
    const retainStdout = options.onStdout === undefined
    const retainStderr = options.onStderr === undefined
    let observedStdoutLength = 0
    let observedStderrLength = 0
    // The appender keeps the accumulator under twice the tail so it is not re-cut on every chunk,
    // which leaves it anywhere in that band when the stream ends. E2B tails the value it returns,
    // so the final cut has to happen here too or a stream finishing between one and two tails comes
    // back longer on Daytona than on E2B — a failover divergence, which is what this adapter pair
    // must never have.
    const finalStdout = () => (retainStdout ? stdout : tailStreamedSandboxOutput(stdout))
    const finalStderr = () => (retainStderr ? stderr : tailStreamedSandboxOutput(stderr))
    try {
      await this.sandbox.process.createSession(sessionId)
      sessionCreated = true
      let script = command
      if (options.envs && Object.keys(options.envs).length > 0) {
        const envPath = `/tmp/.sim-env-${generateShortId(12)}`
        const envFile = Object.entries(options.envs)
          .map(([key, value]) => `${key}=${shellQuote(value)}`)
          .join('\n')
        await this.writeFile(envPath, envFile)
        script = `set -a; . ${envPath}; set +a; rm -f ${envPath}; ${command}`
      }
      if (options.atMostOnce) {
        script = `printf '%s\\n' '${DAYTONA_STREAM_READY_MARKER}'; IFS= read -r _ || exit 78; ${script}`
      }

      let started
      try {
        started = await this.sandbox.process.executeSessionCommand(
          sessionId,
          {
            command: script,
            runAsync: true,
            ...(options.atMostOnce ? { suppressInputEcho: true } : {}),
          },
          toSeconds(options.timeoutMs)
        )
      } catch (error) {
        if (options.signal?.aborted || isDaytonaExecutionTimeout(error)) throw error
        if (options.atMostOnce) {
          throw new SandboxLaunchIndeterminateError('Daytona', { cause: error })
        }
        throw error
      }
      const commandId = started?.cmdId ?? started?.commandId
      if (typeof commandId !== 'string' || commandId.length === 0) {
        throw new SandboxLaunchIndeterminateError('Daytona')
      }
      // Accumulate the streamed chunks as well as forwarding them: callers read
      // markers out of stdout (the Pi cloud flow parses __BASE_SHA__/__CHANGED__)
      // and format failures from stderr, so returning empty strings here would
      // both break marker extraction and blank out error messages even though
      // the callbacks fired correctly.
      // The `.catch` keeps its own reference to the stream's outcome AND ensures a
      // late rejection is always handled — when the timeout wins the race, this
      // promise is abandoned and deleteSession (finally) tears the session down,
      // which rejects it; without the handler that would be an unhandledRejection.
      let streamError: unknown
      let handshakeError: unknown
      let releaseRequested = false
      let initialHandshakeBuffer = ''
      let resolveOutputLimit!: () => void
      const outputLimitExceeded = new Promise<'output-limit'>((resolve) => {
        resolveOutputLimit = () => resolve('output-limit')
      })
      const appendOutput = (
        chunk: string,
        append: (value: string) => void,
        retain: boolean,
        callback?: (value: string) => void
      ) => {
        if (retain) {
          try {
            outputBudget.add(chunk)
          } catch {
            void this.kill().catch(() => {})
            resolveOutputLimit()
            return
          }
        }
        append(chunk)
        callback?.(chunk)
      }
      let resolveHandshakeError!: () => void
      const handshakeFailed = new Promise<'handshake-error'>((resolve) => {
        resolveHandshakeError = () => resolve('handshake-error')
      })
      const releaseCommand = (): void => {
        if (!options.atMostOnce || releaseRequested) return
        releaseRequested = true
        void this.sandbox.process
          .sendSessionCommandInput(sessionId, commandId, '\n')
          .catch((error: unknown) => {
            handshakeError = error
            resolveHandshakeError()
          })
      }
      const appendInitialStdout = (chunk: string): void => {
        if (!options.atMostOnce || releaseRequested) {
          if (!retainStdout) observedStdoutLength += chunk.length
          appendOutput(
            chunk,
            (value) => {
              stdout = retainStdout ? stdout + value : appendStreamedSandboxOutput(stdout, value)
            },
            retainStdout,
            options.onStdout
          )
          return
        }

        initialHandshakeBuffer += chunk
        const marker = `${DAYTONA_STREAM_READY_MARKER}\n`
        const markerIndex = initialHandshakeBuffer.indexOf(marker)
        if (markerIndex < 0) return
        const remaining = initialHandshakeBuffer.slice(markerIndex + marker.length)
        initialHandshakeBuffer = ''
        releaseCommand()
        if (remaining) appendInitialStdout(remaining)
      }
      const streamDeadlineAt = Date.now() + options.timeoutMs
      const streamed = this.sandbox.process
        .getSessionCommandLogs(
          sessionId,
          commandId,
          (chunk: string) => {
            appendInitialStdout(chunk)
          },
          (chunk: string) => {
            if (!retainStderr) observedStderrLength += chunk.length
            appendOutput(
              chunk,
              (value) => {
                stderr = retainStderr ? stderr + value : appendStreamedSandboxOutput(stderr, value)
              },
              retainStderr,
              options.onStderr
            )
          }
        )
        .then(() => 'done' as const)
        .catch((error: unknown) => {
          streamError = error
          return 'error' as const
        })

      // `runAsync: true` returns immediately, so the timeout must be enforced here
      // — otherwise a hung command streams forever, unlike E2B's commands.run
      // which honors timeoutMs for the whole run. On timeout, the finally's
      // deleteSession terminates the still-running command.
      let timer: ReturnType<typeof setTimeout> | undefined
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), Math.max(0, streamDeadlineAt - Date.now()))
      })
      let abortListener: (() => void) | undefined
      const aborted = new Promise<'aborted'>((resolve) => {
        abortListener = () => {
          void this.kill().catch(() => {})
          resolve('aborted')
        }
        options.signal?.addEventListener('abort', abortListener, { once: true })
        if (options.signal?.aborted) abortListener()
      })
      let outcome: 'done' | 'error' | 'timeout' | 'aborted' | 'output-limit' | 'handshake-error'
      try {
        outcome = await Promise.race([
          streamed,
          timedOut,
          aborted,
          outputLimitExceeded,
          handshakeFailed,
        ])
      } finally {
        if (timer) clearTimeout(timer)
        if (abortListener) options.signal?.removeEventListener('abort', abortListener)
      }
      if (outcome === 'aborted') {
        throw options.signal?.reason instanceof Error
          ? options.signal.reason
          : new DOMException('Execution cancelled', 'AbortError')
      }
      if (outcome === 'output-limit' || outputBudget.error) throw outputBudget.error
      if (outcome === 'handshake-error') {
        throw new SandboxLaunchIndeterminateError('Daytona', { cause: handshakeError })
      }
      if (outcome === 'timeout') {
        return {
          stdout: finalStdout(),
          stderr: finalStderr() || `Command timed out after ${options.timeoutMs}ms`,
          exitCode: 124,
          timedOut: true,
        }
      }
      if (outcome === 'error') {
        if (outputBudget.error) throw outputBudget.error
        const timedOut = isDaytonaExecutionTimeout(streamError)
        if (timedOut) {
          return {
            stdout: finalStdout(),
            stderr: finalStderr() || getErrorMessage(streamError),
            exitCode: 124,
            timedOut,
          }
        }

        if (!options.atMostOnce) throw streamError

        logger.warn('Daytona command event stream disconnected; reconnecting to the same process', {
          sandboxId: this.sandboxId,
          sessionId,
          commandId,
        })
        let recoveredStdout = ''
        let recoveredStderr = ''
        let recoveredStdoutPrefix = ''
        let stdoutReplayRemaining = retainStdout ? 0 : observedStdoutLength
        let stderrReplayRemaining = retainStderr ? 0 : observedStderrLength
        let recoveryMarkerPending = options.atMostOnce === true
        const recoveryOutputBudget = new SandboxProcessOutputBudget(
          options.maxOutputBytes ?? MAX_SANDBOX_PROCESS_OUTPUT_BYTES
        )
        const appendRecoveredOutput = (
          chunk: string,
          append: (value: string) => void,
          retain: boolean,
          callback?: (value: string) => void
        ): void => {
          if (retain) {
            try {
              recoveryOutputBudget.add(chunk)
            } catch (outputError) {
              void this.kill().catch(() => {})
              throw outputError
            }
          }
          append(chunk)
          if (!retain) callback?.(chunk)
        }
        const skipObservedReplay = (chunk: string, remaining: number): [string, number] => {
          const skipped = Math.min(chunk.length, remaining)
          return [chunk.slice(skipped), remaining - skipped]
        }
        const appendRecoveredStdout = (chunk: string): void => {
          if (!recoveryMarkerPending) {
            const [suffix, remaining] = skipObservedReplay(chunk, stdoutReplayRemaining)
            stdoutReplayRemaining = remaining
            if (!suffix) return
            appendRecoveredOutput(
              suffix,
              (value) => {
                recoveredStdout = retainStdout
                  ? recoveredStdout + value
                  : appendStreamedSandboxOutput(recoveredStdout, value)
              },
              retainStdout,
              options.onStdout
            )
            return
          }

          recoveredStdoutPrefix += chunk
          const marker = `${DAYTONA_STREAM_READY_MARKER}\n`
          if (
            marker.startsWith(recoveredStdoutPrefix) &&
            recoveredStdoutPrefix.length < marker.length
          ) {
            return
          }

          recoveryMarkerPending = false
          const markerWasPresent = recoveredStdoutPrefix.startsWith(marker)
          const remaining = markerWasPresent
            ? recoveredStdoutPrefix.slice(marker.length)
            : recoveredStdoutPrefix
          recoveredStdoutPrefix = ''
          if (!releaseRequested && markerWasPresent) releaseCommand()
          if (remaining) {
            appendRecoveredStdout(remaining)
          }
        }
        let recoveryStreamError: unknown
        const recoveryStreamed = this.sandbox.process
          .getSessionCommandLogs(
            sessionId,
            commandId,
            (chunk: string) => {
              appendRecoveredStdout(chunk)
            },
            (chunk: string) => {
              const [suffix, remaining] = skipObservedReplay(chunk, stderrReplayRemaining)
              stderrReplayRemaining = remaining
              if (!suffix) return
              appendRecoveredOutput(
                suffix,
                (value) => {
                  recoveredStderr = retainStderr
                    ? recoveredStderr + value
                    : appendStreamedSandboxOutput(recoveredStderr, value)
                },
                retainStderr,
                options.onStderr
              )
            }
          )
          .then(() => 'done' as const)
          .catch((error: unknown) => {
            recoveryStreamError = error
            return 'error' as const
          })
        let recoveryTimer: ReturnType<typeof setTimeout> | undefined
        const recoveryTimedOut = new Promise<'timeout'>((resolve) => {
          recoveryTimer = setTimeout(
            () => resolve('timeout'),
            Math.max(0, streamDeadlineAt - Date.now())
          )
        })
        let recoveryAbortListener: (() => void) | undefined
        const recoveryAborted = new Promise<'aborted'>((resolve) => {
          recoveryAbortListener = () => {
            void this.kill().catch(() => {})
            resolve('aborted')
          }
          options.signal?.addEventListener('abort', recoveryAbortListener, { once: true })
          if (options.signal?.aborted) recoveryAbortListener()
        })
        let recoveryOutcome: 'done' | 'error' | 'timeout' | 'aborted'
        try {
          recoveryOutcome = await Promise.race([
            recoveryStreamed,
            recoveryTimedOut,
            recoveryAborted,
          ])
        } finally {
          if (recoveryTimer) clearTimeout(recoveryTimer)
          if (recoveryAbortListener) {
            options.signal?.removeEventListener('abort', recoveryAbortListener)
          }
        }
        if (recoveryOutcome === 'aborted') {
          throw options.signal?.reason instanceof Error
            ? options.signal.reason
            : new DOMException('Execution cancelled', 'AbortError')
        }
        if (recoveryOutcome === 'timeout') {
          return {
            stdout: finalStdout(),
            stderr: finalStderr() || `Command timed out after ${options.timeoutMs}ms`,
            exitCode: 124,
            timedOut: true,
          }
        }
        if (recoveryOutcome === 'error') {
          if (recoveryOutputBudget.error) throw recoveryOutputBudget.error
          throw new SandboxLaunchIndeterminateError('Daytona', { cause: recoveryStreamError })
        }

        const mergeRecoveredStream = (existing: string, recovered: string, retain: boolean) => {
          if (!retain) {
            return appendStreamedSandboxOutput(existing, recovered)
          }
          const recoveredIncludesExisting = recovered.startsWith(existing)
          return recoveredIncludesExisting ? recovered : existing + recovered
        }
        stdout = mergeRecoveredStream(stdout, recoveredStdout, retainStdout)
        stderr = mergeRecoveredStream(stderr, recoveredStderr, retainStderr)
        assertSandboxProcessOutputWithinLimit([stdout, stderr], options.maxOutputBytes)
      }

      const finished = await this.sandbox.process.getSessionCommand(sessionId, commandId)
      const exitCode = finished.exitCode ?? 0
      return { stdout: finalStdout(), stderr: finalStderr(), exitCode }
    } catch (error) {
      if (isSandboxOutputLimitError(error)) {
        void this.kill().catch(() => {})
        throw error
      }
      if (isNonRetryableExecutionError(error)) throw error
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException('Execution cancelled', 'AbortError')
      }
      if (isDaytonaExecutionTimeout(error)) {
        return {
          stdout: finalStdout(),
          stderr: finalStderr() || getErrorMessage(error),
          exitCode: 124,
          timedOut: true,
        }
      }
      if (operation === 'code') throw error
      return { stdout: finalStdout(), stderr: finalStderr() || getErrorMessage(error), exitCode: 1 }
    } finally {
      if (sessionCreated) {
        try {
          await this.sandbox.process.deleteSession(sessionId)
        } catch {}
      }
    }
  }

  async readFile(path: string): Promise<string> {
    return this.readFileWithLimit(path, {
      maxBytes: MAX_SANDBOX_OUTPUT_BYTES,
      encoding: 'utf8',
    }).then(({ content }) => content)
  }

  async getFileSize(path: string): Promise<number> {
    const details = await this.sandbox.fs.getFileDetails(path)
    const mode = String(details.mode ?? '')
      .trim()
      .toLowerCase()
    if (details.isDir || !mode.startsWith('-')) throw new SandboxOutputFileError(path)
    return details.size
  }

  async readFileWithLimit(
    path: string,
    options: { maxBytes: number; encoding: 'utf8' | 'base64'; signal?: AbortSignal }
  ): Promise<{ content: string; byteLength: number }> {
    const size = await this.getFileSize(path)
    if (size > options.maxBytes) {
      throw new SandboxOutputLimitError(size, options.maxBytes)
    }

    const stream = await this.sandbox.fs.downloadFileStream(path, {
      timeout: 120,
      signal: options.signal,
    })
    stream.once('error', () => {})
    try {
      const buffer = await readNodeStreamToBufferWithLimit(stream, {
        maxBytes: options.maxBytes,
        label: 'Sandbox output file',
        signal: options.signal,
      })
      return {
        content: buffer.toString(options.encoding === 'base64' ? 'base64' : 'utf8'),
        byteLength: buffer.byteLength,
      }
    } catch (error) {
      if (isPayloadSizeLimitError(error)) {
        throw new SandboxOutputLimitError(
          error.observedBytes ?? options.maxBytes + 1,
          options.maxBytes
        )
      }
      throw error
    }
  }

  async writeFile(path: string, content: string | ArrayBuffer): Promise<void> {
    const buffer =
      typeof content === 'string' ? Buffer.from(content, 'utf-8') : Buffer.from(content)
    await this.sandbox.fs.uploadFile(buffer, path)
  }

  async kill(): Promise<void> {
    if (this.killed) return
    if (!this.killPromise) {
      this.killPromise = this.sandbox
        .delete()
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

/** Quotes a value for a POSIX `KEY=value` env file. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Daytona takes the `runtime` strategy and exposes no image builder.
 *
 * Prebuilt images are not available at any tier: the 30-active-snapshot quota
 * lives on the organization rather than the plan, snapshots auto-deactivate
 * after 14 days unused, and raising the quota needs Daytona support. Since
 * builds are content-addressed and shared, 30 would be the ceiling for all of
 * Sim rather than per workspace. Installing per execution consumes no quota.
 */
export const daytonaProvider: SandboxProvider = {
  id: 'daytona',
  dependencyStrategy: 'runtime',
  async create(kind: SandboxKind, options?: CreateSandboxOptions): Promise<SandboxHandle> {
    const apiKey = env.DAYTONA_API_KEY
    if (!apiKey) {
      throw new Error('DAYTONA_API_KEY is required when the Daytona sandbox provider is selected')
    }
    const snapshot = snapshotFor(kind, options?.imageRef)
    const language = options?.language ?? CodeLanguage.Python
    logger.info('Creating Daytona sandbox', { kind, snapshot })

    const { Daytona } = await import('@daytona/sdk')
    const daytona = new Daytona({ apiKey })
    const createOptions: CreateSandboxFromSnapshotParams = {
      snapshot,
      language: toDaytonaLanguage(language),
      ephemeral: true,
      ttlMinutes: Math.max(
        1,
        Math.ceil((options?.lifetimeMs ?? DAYTONA_DEFAULT_SANDBOX_TTL_MS) / 60_000)
      ),
    }
    const sandbox = await daytona.create(createOptions)

    return new DaytonaSandboxHandle(sandbox, language)
  },
}
