import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import type { CodeLanguage } from '@/lib/execution/languages'
import { daytonaProvider } from '@/lib/execution/remote-sandbox/daytona'
import { e2bProvider } from '@/lib/execution/remote-sandbox/e2b'
import type {
  SandboxCommandResult,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxFile,
  SandboxHandle,
  SandboxKind,
  SandboxProvider,
  SandboxProviderId,
  SandboxShellExecutionRequest,
} from '@/lib/execution/remote-sandbox/types'

export type {
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxFile,
  SandboxShellExecutionRequest,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('RemoteSandbox')

/**
 * The known sandbox providers. Keyed by {@link SandboxProviderId}, so adding an
 * adapter is one entry here plus one member on the id union — the type makes an
 * unhandled provider a compile error, not a runtime surprise.
 */
const PROVIDERS: Record<SandboxProviderId, SandboxProvider> = {
  e2b: e2bProvider,
  daytona: daytonaProvider,
}

const DEFAULT_PROVIDER: SandboxProviderId = 'e2b'

/**
 * Resolves which provider serves this execution from the `SANDBOX_PROVIDER` env
 * var (defaulting to {@link DEFAULT_PROVIDER}).
 *
 * Selection is deliberately resolved ONCE, before the sandbox is created, and is
 * never revisited mid-execution: user code has side effects (HTTP calls, S3
 * writes, DB mutations), so retrying a partially-executed run on another provider
 * could duplicate them. Changing providers is a config change — set
 * `SANDBOX_PROVIDER` and redeploy; in-flight executions are unaffected.
 */
function resolveProvider(): SandboxProvider {
  const configured = env.SANDBOX_PROVIDER
  if (!configured) return PROVIDERS[DEFAULT_PROVIDER]
  const provider = PROVIDERS[configured as SandboxProviderId]
  if (!provider) {
    throw new Error(
      `Unknown SANDBOX_PROVIDER "${configured}" (expected one of: ${Object.keys(PROVIDERS).join(', ')})`
    )
  }
  return provider
}

async function createSandbox(
  kind: SandboxKind,
  options?: { language?: CodeLanguage }
): Promise<SandboxHandle> {
  const provider = resolveProvider()
  const sandbox = await provider.create(kind, options)
  logger.info('Created sandbox', { provider: provider.id, kind, sandboxId: sandbox.sandboxId })
  return sandbox
}

/**
 * Materializes sandbox input files before user code runs. `content` entries are written inline;
 * `url` entries are fetched from inside the sandbox via `curl` — their bytes never pass through the
 * web process, so the mount size is bounded by sandbox disk, not web heap. The URL and paths are
 * passed as env vars (never interpolated into the shell) so a presigned query string can't break or
 * inject. A failed fetch throws so user code never runs against a missing mount.
 */
async function writeSandboxInputs(
  sandbox: SandboxHandle,
  files: SandboxFile[] | undefined,
  opts: { rootUser?: boolean }
): Promise<void> {
  if (!files?.length) return
  const fetchedByUrl: string[] = []
  const writtenInline: string[] = []
  for (const file of files) {
    if (file.type === 'url') {
      const dir = file.path.slice(0, file.path.lastIndexOf('/'))
      let result: SandboxCommandResult
      try {
        result = await sandbox.runCommand(
          'set -e; [ -n "$DIR" ] && mkdir -p "$DIR"; curl -fsS --retry 3 --retry-connrefused --max-time 300 "$URL" -o "$DST"',
          {
            envs: { URL: file.url, DST: file.path, DIR: dir },
            timeoutMs: 300_000,
            rootUser: opts.rootUser,
          }
        )
      } catch (error) {
        throw new Error(
          `Failed to fetch mounted file into sandbox at ${file.path}: ${getErrorMessage(error)}`
        )
      }
      // Providers differ on whether a non-zero exit throws, so the exit code is
      // checked explicitly — a silently-missing mount is exactly what this guard
      // exists to prevent.
      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to fetch mounted file into sandbox at ${file.path}: ${result.stderr || `curl exited ${result.exitCode}`}`
        )
      }
      fetchedByUrl.push(file.path)
    } else if (file.encoding === 'base64') {
      const buf = Buffer.from(file.content, 'base64')
      await sandbox.writeFile(
        file.path,
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      )
      writtenInline.push(file.path)
    } else {
      await sandbox.writeFile(file.path, file.content)
      writtenInline.push(file.path)
    }
  }
  // Split counts so it's visible whether a mount was fetched in-sandbox (by presigned URL, no bytes
  // through the web process) or written inline.
  logger.info('Materialized sandbox inputs', {
    sandboxId: sandbox.sandboxId,
    fetchedByUrlCount: fetchedByUrl.length,
    writtenInlineCount: writtenInline.length,
    fetchedByUrl,
    writtenInline,
  })
}

/**
 * Marker prefix for the serialized code result printed to stdout. Emitters
 * (the wrapper builders in the function-execute route) interpolate this
 * constant so producer and parser cannot drift.
 */
export const SIM_RESULT_PREFIX = '__SIM_RESULT__='

/**
 * Extracts the `__SIM_RESULT__=` marker line from stdout and parses its JSON
 * payload. Takes the LAST marker line: the wrapper prints its marker after all
 * user output, so an earlier user-printed line with the same prefix (debug
 * output, a grepped log) never shadows the real result. `parseFailed` means
 * the last marker's payload was not valid JSON — `rawPayload` carries it so
 * callers whose markers are user-authored (shell) can fall back to the plain
 * string, while wrapper-backed callers treat it as transport corruption.
 */
function extractSimResult(stdout: string): {
  result: unknown
  cleanedStdout: string
  parseFailed: boolean
  rawPayload?: string
} {
  const lines = stdout.split('\n')
  let markerIndex = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(SIM_RESULT_PREFIX)) {
      markerIndex = i
      break
    }
  }
  if (markerIndex === -1) {
    return { result: null, cleanedStdout: stdout, parseFailed: false }
  }
  const rawPayload = lines[markerIndex].slice(SIM_RESULT_PREFIX.length)
  let result: unknown = null
  let parseFailed = false
  try {
    result = JSON.parse(rawPayload)
  } catch {
    parseFailed = true
  }
  const filteredLines = lines.filter((l) => !l.startsWith(SIM_RESULT_PREFIX))
  if (filteredLines.length > 0 && filteredLines[filteredLines.length - 1] === '') {
    filteredLines.pop()
  }
  return { result, cleanedStdout: filteredLines.join('\n'), parseFailed, rawPayload }
}

const SIM_RESULT_CORRUPTED_ERROR =
  'Sandbox result was corrupted in transport (the __SIM_RESULT__ line failed to parse). ' +
  "Do not trust or persist this call's output. For large results, write the content to a " +
  'file inside the sandbox and export it via outputs.files[].sandboxPath instead of returning it.'

function shouldReadSandboxPathAsBase64(outputSandboxPath: string): boolean {
  const ext = outputSandboxPath.slice(outputSandboxPath.lastIndexOf('.')).toLowerCase()
  const binaryExts = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.pdf',
    '.zip',
    '.mp3',
    '.mp4',
    '.docx',
    '.pptx',
    '.xlsx',
  ])
  return binaryExts.has(ext)
}

async function readSandboxOutputFile(
  sandbox: SandboxHandle,
  outputSandboxPath: string,
  options?: { rootUser?: boolean }
): Promise<string | undefined> {
  try {
    if (shouldReadSandboxPathAsBase64(outputSandboxPath)) {
      const b64Result = await sandbox.runCommand(`base64 -w0 "${outputSandboxPath}"`, {
        timeoutMs: 120_000,
        rootUser: options?.rootUser,
      })
      if (b64Result.exitCode !== 0) throw new Error(b64Result.stderr || 'base64 failed')
      return b64Result.stdout
    }
    return await sandbox.readFile(outputSandboxPath)
  } catch (error) {
    logger.warn('Failed to read requested sandbox output file', {
      outputSandboxPath,
      error: getErrorMessage(error),
    })
    return undefined
  }
}

function requestedOutputSandboxPaths(req: {
  outputSandboxPath?: string
  outputSandboxPaths?: string[]
}): string[] {
  const paths = [...(req.outputSandboxPaths ?? [])]
  if (req.outputSandboxPath && !paths.includes(req.outputSandboxPath)) {
    paths.push(req.outputSandboxPath)
  }
  return paths
}

async function collectExportedFiles(
  sandbox: SandboxHandle,
  req: { outputSandboxPath?: string; outputSandboxPaths?: string[] },
  options?: { rootUser?: boolean }
): Promise<{ exportedFiles?: Record<string, string>; exportedFileContent?: string }> {
  const exportedFiles: Record<string, string> = {}
  for (const outputSandboxPath of requestedOutputSandboxPaths(req)) {
    const content = await readSandboxOutputFile(sandbox, outputSandboxPath, options)
    if (content !== undefined) {
      exportedFiles[outputSandboxPath] = content
    }
  }
  return {
    exportedFileContent: req.outputSandboxPath ? exportedFiles[req.outputSandboxPath] : undefined,
    exportedFiles: Object.keys(exportedFiles).length ? exportedFiles : undefined,
  }
}

export async function executeInSandbox(
  req: SandboxExecutionRequest
): Promise<SandboxExecutionResult> {
  const { code, language, timeoutMs } = req

  const sandbox = await createSandbox(req.sandboxKind ?? 'code', { language })
  const sandboxId = sandbox.sandboxId

  try {
    // Inside the try so a failed mount still kills the sandbox via the finally below.
    await writeSandboxInputs(sandbox, req.sandboxFiles, {})

    const execution = await sandbox.runCode(code, { timeoutMs })

    if (execution.error) {
      const errorMessage = `${execution.error.name}: ${execution.error.value}`
      logger.error('Sandbox execution error', { sandboxId, error: execution.error, errorMessage })
      return {
        result: null,
        stdout: execution.error.traceback || errorMessage,
        error: errorMessage,
        sandboxId,
      }
    }

    // Distinct sources (final-expression text, stdout, stderr) join with '\n' so
    // the marker is found no matter which stream carried it. Each individual
    // stream is already concatenated verbatim by the provider, because injecting
    // a newline at chunk boundaries corrupted large single-line payloads.
    const combinedOutput = [execution.text, execution.stdout, execution.stderr]
      .filter(Boolean)
      .join('\n')

    const extraction = extractSimResult(combinedOutput)
    const cleanedStdout = extraction.cleanedStdout

    // The wrapper always emits valid single-line JSON, so a marker that fails
    // to parse means the payload was mangled in transport — never persist it.
    if (extraction.parseFailed) {
      logger.error('Sandbox result marker failed to parse', {
        sandboxId,
        stdoutLength: execution.stdout.length,
      })
      return {
        result: null,
        stdout: cleanedStdout,
        error: SIM_RESULT_CORRUPTED_ERROR,
        sandboxId,
      }
    }

    const { exportedFiles, exportedFileContent } = await collectExportedFiles(sandbox, req)

    return {
      result: extraction.result,
      stdout: cleanedStdout,
      sandboxId,
      exportedFileContent,
      exportedFiles,
    }
  } finally {
    try {
      await sandbox.kill()
    } catch {}
  }
}

export async function executeShellInSandbox(
  req: SandboxShellExecutionRequest
): Promise<SandboxExecutionResult> {
  const { code, envs, timeoutMs } = req

  const sandbox = await createSandbox(req.sandboxKind ?? 'shell')
  const sandboxId = sandbox.sandboxId

  try {
    // Inside the try so a failed mount still kills the sandbox via the finally below.
    await writeSandboxInputs(sandbox, req.sandboxFiles, { rootUser: true })

    const result = await sandbox.runCommand(code, {
      envs: {
        ...envs,
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.local/bin',
      },
      timeoutMs,
      rootUser: true,
    })

    const stdout = [result.stdout, result.stderr].filter(Boolean).join('\n')

    if (result.exitCode !== 0) {
      const errorMessage = result.stderr || `Process exited with code ${result.exitCode}`
      logger.error('Sandbox shell execution error', {
        sandboxId,
        exitCode: result.exitCode,
        stderr: result.stderr?.slice(0, 500),
      })
      return { result: null, stdout, error: errorMessage, sandboxId }
    }

    // Shell scripts have no wrapper: any __SIM_RESULT__ line is user-authored
    // (e.g. `echo "__SIM_RESULT__=$STATUS"`), so a non-JSON payload is a plain
    // string result, not transport corruption.
    const extraction = extractSimResult(stdout)
    const parsed = extraction.parseFailed ? extraction.rawPayload : extraction.result

    const { exportedFiles, exportedFileContent } = await collectExportedFiles(sandbox, req, {
      rootUser: true,
    })

    return {
      result: parsed,
      stdout: extraction.cleanedStdout,
      sandboxId,
      exportedFileContent,
      exportedFiles,
    }
  } finally {
    try {
      await sandbox.kill()
    } catch {}
  }
}

/** Result of one command run inside a Pi sandbox. */
export interface PiSandboxCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Runs commands and moves files inside a live Pi sandbox. */
export interface PiSandboxRunner {
  run(
    command: string,
    options: {
      envs?: Record<string, string>
      timeoutMs: number
      onStdout?: (chunk: string) => void
      onStderr?: (chunk: string) => void
    }
  ): Promise<PiSandboxCommandResult>
  readFile(path: string): Promise<string>
  /**
   * Writes a file via the sandbox filesystem API. Bytes go through the provider
   * SDK, never a shell, so untrusted content (the assembled prompt, a commit
   * message) is delivered without any shell parsing — callers reference it by a
   * fixed path.
   */
  writeFile(path: string, content: string): Promise<void>
}

/**
 * Creates a Pi sandbox, keeps it alive for the duration of `fn` (so the cloned
 * repo persists across the clone -> agent -> push commands), streams command
 * output, and always kills the sandbox afterward. Per-command envs are isolated,
 * so secrets handed to one command never leak into the next.
 */
export async function withPiSandbox<T>(fn: (runner: PiSandboxRunner) => Promise<T>): Promise<T> {
  const sandbox = await createSandbox('pi')
  logger.info('Started Pi sandbox', { sandboxId: sandbox.sandboxId })

  const runner: PiSandboxRunner = {
    run: (command, options) =>
      sandbox.runCommand(command, {
        envs: options.envs,
        timeoutMs: options.timeoutMs,
        rootUser: true,
        onStdout: options.onStdout,
        onStderr: options.onStderr,
      }),
    readFile: (path) => sandbox.readFile(path),
    writeFile: (path, content) => sandbox.writeFile(path, content),
  }

  try {
    return await fn(runner)
  } finally {
    try {
      await sandbox.kill()
    } catch {}
  }
}
