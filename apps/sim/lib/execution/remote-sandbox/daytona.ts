import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { env } from '@/lib/core/config/env'
import { CodeLanguage } from '@/lib/execution/languages'
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

/** Daytona expresses every timeout in seconds; the rest of Sim works in milliseconds. */
function toSeconds(timeoutMs: number): number {
  return Math.max(1, Math.ceil(timeoutMs / 1000))
}

function snapshotFor(kind: SandboxKind): string {
  // Mirrors the E2B provider's fail-closed behaviour: never let LLM-authored code
  // run in a provider default image just because a snapshot id is unset.
  const snapshot =
    kind === 'doc'
      ? env.DAYTONA_DOC_SNAPSHOT_ID
      : kind === 'pi'
        ? env.DAYTONA_PI_SNAPSHOT_ID
        : env.DAYTONA_SHELL_SNAPSHOT_ID
  if (!snapshot) {
    const varName =
      kind === 'doc'
        ? 'DAYTONA_DOC_SNAPSHOT_ID'
        : kind === 'pi'
          ? 'DAYTONA_PI_SNAPSHOT_ID'
          : 'DAYTONA_SHELL_SNAPSHOT_ID'
    throw new Error(`Daytona sandbox not configured (${varName} is unset)`)
  }
  return snapshot
}

/** Daytona binds `codeRun`'s language to the sandbox, not the call. */
function toDaytonaLanguage(language: CodeLanguage): string {
  return language === CodeLanguage.Python ? 'python' : 'javascript'
}

class DaytonaSandboxHandle implements SandboxHandle {
  constructor(
    private readonly sandbox: any,
    private readonly language: CodeLanguage
  ) {}

  get sandboxId(): string {
    return this.sandbox.id
  }

  async runCode(code: string, options: { timeoutMs: number }): Promise<SandboxCodeResult> {
    // Python goes through CodeInterpreter because it reports a structured
    // `{ name, value, traceback }` error — the same shape E2B returns, which the
    // route's line-offset error formatting depends on. CodeInterpreter is
    // Python-only, so JS falls back to `process.codeRun`, whose language comes
    // from the label bound at sandbox creation.
    if (this.language === CodeLanguage.Python) {
      const result = await this.sandbox.codeInterpreter.runCode(code, {
        timeout: toSeconds(options.timeoutMs),
      })
      return {
        text: '',
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        error: result.error
          ? {
              name: result.error.name,
              value: result.error.value ?? result.error.message ?? '',
              traceback: result.error.traceback,
            }
          : undefined,
      }
    }

    const result = await this.sandbox.process.codeRun(code, undefined, toSeconds(options.timeoutMs))
    const output: string = result.result ?? ''
    if (result.exitCode !== 0) {
      // `process.codeRun` has no structured error channel — the interpreter's
      // stderr lands in `result`. Surface it as the traceback so the shape stays
      // identical to the Python and E2B paths.
      return {
        text: '',
        stdout: '',
        stderr: output,
        error: { name: 'Error', value: lastNonEmptyLine(output), traceback: output },
      }
    }
    return { text: '', stdout: output, stderr: '' }
  }

  async runCommand(command: string, options: RunCommandOptions): Promise<SandboxCommandResult> {
    // `rootUser` needs no handling: Daytona already executes commands as uid 0.
    if (options.onStdout || options.onStderr) {
      return this.runStreamingCommand(command, options)
    }
    try {
      const result = await this.sandbox.process.executeCommand(
        command,
        undefined,
        options.envs,
        toSeconds(options.timeoutMs)
      )
      // Daytona merges the two streams into `result`; splitting them back out is
      // not possible, so stdout carries everything and callers that join the two
      // (every caller today) are unaffected.
      return { stdout: result.result ?? '', stderr: '', exitCode: result.exitCode ?? 0 }
    } catch (error) {
      return { stdout: '', stderr: getErrorMessage(error), exitCode: 1 }
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
    options: RunCommandOptions
  ): Promise<SandboxCommandResult> {
    const sessionId = `sim-${generateShortId(12)}`
    await this.sandbox.process.createSession(sessionId)
    // Declared outside the try so the catch can return whatever streamed before a
    // failure, rather than blanking the output.
    let stdout = ''
    let stderr = ''
    try {
      let script = command
      if (options.envs && Object.keys(options.envs).length > 0) {
        const envPath = `/tmp/.sim-env-${generateShortId(12)}`
        const envFile = Object.entries(options.envs)
          .map(([key, value]) => `${key}=${shellQuote(value)}`)
          .join('\n')
        await this.writeFile(envPath, envFile)
        script = `set -a; . ${envPath}; set +a; rm -f ${envPath}; ${command}`
      }

      const started = await this.sandbox.process.executeSessionCommand(
        sessionId,
        { command: script, runAsync: true },
        toSeconds(options.timeoutMs)
      )
      const commandId: string = started.cmdId ?? started.commandId
      // Accumulate the streamed chunks as well as forwarding them: callers read
      // markers out of stdout (the Pi cloud flow parses __BASE_SHA__/__CHANGED__)
      // and format failures from stderr, so returning empty strings here would
      // both break marker extraction and blank out error messages even though
      // the callbacks fired correctly.
      const streamed = this.sandbox.process
        .getSessionCommandLogs(
          sessionId,
          commandId,
          (chunk: string) => {
            stdout += chunk
            options.onStdout?.(chunk)
          },
          (chunk: string) => {
            stderr += chunk
            options.onStderr?.(chunk)
          }
        )
        .then(() => 'done' as const)

      // `runAsync: true` returns immediately, so the timeout must be enforced here
      // — otherwise a hung command streams forever, unlike E2B's commands.run
      // which honors timeoutMs for the whole run. On timeout, the finally's
      // deleteSession terminates the still-running command.
      let timer: ReturnType<typeof setTimeout> | undefined
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), options.timeoutMs)
      })
      try {
        const outcome = await Promise.race([streamed, timedOut])
        if (outcome === 'timeout') {
          return {
            stdout,
            stderr: stderr || `Command timed out after ${options.timeoutMs}ms`,
            exitCode: 124,
          }
        }
      } finally {
        if (timer) clearTimeout(timer)
      }

      const finished = await this.sandbox.process.getSessionCommand(sessionId, commandId)
      return { stdout, stderr, exitCode: finished.exitCode ?? 0 }
    } catch (error) {
      return { stdout, stderr, exitCode: 1 }
    } finally {
      try {
        await this.sandbox.process.deleteSession(sessionId)
      } catch {}
    }
  }

  async readFile(path: string): Promise<string> {
    const buffer = await this.sandbox.fs.downloadFile(path)
    return buffer.toString('utf-8')
  }

  async writeFile(path: string, content: string | ArrayBuffer): Promise<void> {
    const buffer =
      typeof content === 'string' ? Buffer.from(content, 'utf-8') : Buffer.from(content)
    await this.sandbox.fs.uploadFile(buffer, path)
  }

  async kill(): Promise<void> {
    await this.sandbox.delete()
  }
}

/** Quotes a value for a POSIX `KEY=value` env file. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function lastNonEmptyLine(output: string): string {
  const lines = output.split('\n').filter((line) => line.trim().length > 0)
  return lines.length > 0 ? lines[lines.length - 1] : 'Execution failed'
}

export const daytonaProvider: SandboxProvider = {
  id: 'daytona',
  async create(kind: SandboxKind, options?: CreateSandboxOptions): Promise<SandboxHandle> {
    const apiKey = env.DAYTONA_API_KEY
    if (!apiKey) {
      throw new Error('DAYTONA_API_KEY is required when the Daytona sandbox provider is selected')
    }
    const snapshot = snapshotFor(kind)
    const language = options?.language ?? CodeLanguage.Python
    logger.info('Creating Daytona sandbox', { kind, snapshot })

    const { Daytona } = await import('@daytonaio/sdk')
    const daytona = new Daytona({ apiKey })
    const sandbox = await daytona.create({ snapshot, language: toDaytonaLanguage(language) } as any)

    return new DaytonaSandboxHandle(sandbox, language)
  },
}
