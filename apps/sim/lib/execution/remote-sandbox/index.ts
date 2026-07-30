import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { resolvePiSandboxLifetimeMs } from '@/lib/execution/remote-sandbox/pi-lifetime'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import {
  provisionRuntimeDependencies,
  type ResolvedSandbox,
  RUNTIME_INSTALL_TIMEOUT_MS,
  repairMissingSandboxImage,
  resolveWorkspaceSandbox,
} from '@/lib/execution/remote-sandbox/resolve'
import type {
  CreateSandboxOptions,
  SandboxCommandResult,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxFile,
  SandboxHandle,
  SandboxKind,
  SandboxShellExecutionRequest,
} from '@/lib/execution/remote-sandbox/types'

export type {
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxFile,
  SandboxShellExecutionRequest,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('RemoteSandbox')

async function createSandbox(
  kind: SandboxKind,
  options?: CreateSandboxOptions
): Promise<SandboxHandle> {
  const provider = resolveProvider()
  const sandbox = await provider.create(kind, options)
  logger.info('Created sandbox', { provider: provider.id, kind, sandboxId: sandbox.sandboxId })
  return sandbox
}

/**
 * Creates a sandbox, turning "that image is gone" into a rebuild rather than a
 * failure the author has to resolve by hand.
 *
 * Create is the only step that observes whether the provider image really exists,
 * which is why the repair hangs off it: the registry row and the remote template
 * are two systems with no shared transaction, so keeping them in step is always
 * best-effort, while checking at the point of use is not. Any other failure is
 * rethrown untouched.
 */
async function createSelectedSandbox(
  kind: SandboxKind,
  options: CreateSandboxOptions,
  selected: ResolvedSandbox | null
): Promise<SandboxHandle> {
  try {
    return await createSandbox(kind, options)
  } catch (error) {
    if (!selected) throw error
    const rebuilding = await repairMissingSandboxImage(selected, error)
    if (!rebuilding) throw error
    throw new Error(rebuilding)
  }
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
        // Daytona merges streams into stdout, so fall back to it for the real error.
        throw new Error(
          `Failed to fetch mounted file into sandbox at ${file.path}: ${result.stderr || result.stdout || `curl exited ${result.exitCode}`}`
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
      // Daytona merges streams into stdout, so fall back to it for the real error.
      if (b64Result.exitCode !== 0) {
        throw new Error(b64Result.stderr || b64Result.stdout || 'base64 failed')
      }
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

/**
 * Floor on what is left for the user's code after a runtime install. Below this
 * the run is not worth attempting — but reporting "your code timed out" would
 * still be the wrong story, so the install's own budget is capped to leave it.
 */
const MIN_CODE_BUDGET_MS = 15_000

/**
 * How long a runtime dependency install may take before it must yield to the
 * code it is installing for. Capped by {@link RUNTIME_INSTALL_TIMEOUT_MS} and by
 * whatever the caller's budget leaves after reserving {@link MIN_CODE_BUDGET_MS}.
 */
function installBudgetMs(timeoutMs: number): number {
  return Math.max(0, Math.min(RUNTIME_INSTALL_TIMEOUT_MS, timeoutMs - MIN_CODE_BUDGET_MS))
}

/**
 * Installs a runtime sandbox's dependencies out of the caller's budget and
 * reports what it spent, so the code that follows can be given the remainder.
 *
 * Deliberately times ONLY the install. Mount materialization is not deducted —
 * it predates this accounting and can legitimately run long for a large
 * presigned fetch, so charging it here would shorten the code budget of existing
 * prebuilt-strategy workflows that never had an install step at all.
 */
async function provisionWithinBudget(
  sandbox: SandboxHandle,
  selected: ResolvedSandbox | null,
  timeoutMs: number
): Promise<number> {
  if (!selected) return 0
  const startedAt = Date.now()
  await provisionRuntimeDependencies(sandbox, selected, { timeoutMs: installBudgetMs(timeoutMs) })
  return Date.now() - startedAt
}

/** What remains of the caller's budget once the install has taken its share. */
function remainingBudgetMs(timeoutMs: number, installMs: number): number {
  return Math.max(MIN_CODE_BUDGET_MS, timeoutMs - installMs)
}

export async function executeInSandbox(
  req: SandboxExecutionRequest
): Promise<SandboxExecutionResult> {
  const { code, language, timeoutMs } = req
  const kind = req.sandboxKind ?? 'code'

  // Resolved before the sandbox is created so a selection that cannot be honored
  // fails without spending a provider create.
  const selected = await resolveWorkspaceSandbox({
    kind,
    language,
    workspaceId: req.workspaceId,
    sandboxId: req.sandboxId,
  })

  const sandbox = await createSelectedSandbox(
    kind,
    { language, imageRef: selected?.imageRef },
    selected
  )
  const sandboxId = sandbox.sandboxId

  try {
    // Inside the try so a failed install or mount still kills the sandbox via the
    // finally below. Dependencies land before the inputs so user code and its
    // mounts always see a complete environment.
    //
    // The install is spent OUT OF the caller's budget, not on top of it. Our
    // caller aborts the whole request at `timeoutMs` (see `tools/index.ts`), so
    // an install that ran to its own separate 240s ceiling would blow past that
    // and surface a bare "Request timed out" instead of the classified install
    // error. Under the prebuilt strategy provisioning returns immediately, so
    // this arithmetic is a no-op there.
    const installMs = await provisionWithinBudget(sandbox, selected, timeoutMs)
    await writeSandboxInputs(sandbox, req.sandboxFiles, {})

    const execution = await sandbox.runCode(code, {
      timeoutMs: remainingBudgetMs(timeoutMs, installMs),
      ...(selected?.envs ? { envs: selected.envs } : {}),
    })

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
  const kind = req.sandboxKind ?? 'shell'

  // No language is passed: a shell execution runs commands rather than a language
  // runtime, so whichever language the sandbox carries is the one it installs.
  const selected = await resolveWorkspaceSandbox({
    kind,
    workspaceId: req.workspaceId,
    sandboxId: req.sandboxId,
  })

  const sandbox = await createSelectedSandbox(kind, { imageRef: selected?.imageRef }, selected)
  const sandboxId = sandbox.sandboxId

  try {
    // Inside the try so a failed install or mount still kills the sandbox via the
    // finally below. The install shares the caller's budget rather than adding to
    // it — see the note in `executeInSandbox`.
    const installMs = await provisionWithinBudget(sandbox, selected, timeoutMs)
    await writeSandboxInputs(sandbox, req.sandboxFiles, { rootUser: true })

    const result = await sandbox.runCommand(code, {
      envs: {
        ...selected?.envs,
        ...envs,
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.local/bin',
      },
      timeoutMs: remainingBudgetMs(timeoutMs, installMs),
      rootUser: true,
    })

    const stdout = [result.stdout, result.stderr].filter(Boolean).join('\n')

    if (result.exitCode !== 0) {
      // Daytona merges both streams into stdout (stderr is always empty), so fall
      // back to stdout for the real command output before the generic message.
      const errorMessage =
        result.stderr || result.stdout || `Process exited with code ${result.exitCode}`
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
 *
 * `options.lifetimeMs` is the run's own budget from `resolvePiRunLifetimeMs`,
 * which a caller holding the execution signal can narrow below the provider
 * ceiling. Omitting it keeps that ceiling — correct for a caller with no
 * deadline to honor, and never longer than before.
 *
 * Options precede the callback so that adding one did not re-indent every
 * caller's sandbox body, which would have buried the change in whitespace.
 */
export async function withPiSandbox<T>(
  options: { lifetimeMs?: number },
  fn: (runner: PiSandboxRunner) => Promise<T>
): Promise<T> {
  const lifetimeMs =
    options.lifetimeMs !== undefined ? options.lifetimeMs : resolvePiSandboxLifetimeMs()
  const sandbox = await createSandbox('pi', { lifetimeMs })
  logger.info('Started Pi sandbox', { sandboxId: sandbox.sandboxId, lifetimeMs })

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
