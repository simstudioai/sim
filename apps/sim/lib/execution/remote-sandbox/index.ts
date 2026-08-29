import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import {
  createTimeoutAbortController,
  getRemainingExecutionMs,
  isTimeoutAbortReason,
} from '@/lib/core/execution-limits'
import { recordSandboxTeardownFailure } from '@/lib/core/execution-limits/metrics'
import { buildJavaScriptRuntimeBindingsSource } from '@/lib/execution/code-placeholders/javascript-runtime'
import { SANDBOX_SYSTEM_PATH } from '@/lib/execution/remote-sandbox/cli-tools.server'
import {
  isSandboxOutputFileError,
  isSandboxOutputLimitError,
  MAX_SANDBOX_OUTPUT_BYTES,
  MAX_SANDBOX_OUTPUT_FILES,
  MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
  MAX_SANDBOX_URL_MOUNT_BYTES,
  SandboxOutputDepthError,
  SandboxOutputDirectoryMissingError,
  SandboxOutputFileCountError,
  SandboxOutputLimitError,
} from '@/lib/execution/remote-sandbox/output-limits'
import { resolvePiSandboxLifetimeMs } from '@/lib/execution/remote-sandbox/pi-lifetime'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import {
  provisionRuntimeDependencies,
  type ResolvedSandbox,
  RUNTIME_INSTALL_TIMEOUT_MS,
  repairMissingSandboxImage,
  resolveWorkspaceSandbox,
} from '@/lib/execution/remote-sandbox/resolve'
import {
  SANDBOX_OUTPUT_DIR_MAX_DEPTH,
  SANDBOX_OUTPUT_DIR_SENTINEL,
} from '@/lib/execution/remote-sandbox/sandbox-paths'
import type {
  CreateSandboxOptions,
  SandboxCodeResult,
  SandboxCollectedFile,
  SandboxCommandResult,
  SandboxDirectoryEntry,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxFile,
  SandboxHandle,
  SandboxKind,
  SandboxPrivateInput,
  SandboxShellExecutionRequest,
} from '@/lib/execution/remote-sandbox/types'

export type {
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxFile,
  SandboxPrivateInput,
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
  selected: ResolvedSandbox | null,
  signal: AbortSignal
): Promise<SandboxHandle> {
  try {
    return await createSandbox(kind, options)
  } catch (error) {
    throwIfAborted(signal)
    if (!selected) throw error
    const rebuilding = await repairMissingSandboxImage(selected, error)
    if (!rebuilding) throw error
    throw new Error(rebuilding)
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Execution cancelled')
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Execution cancelled', 'AbortError')
}

/** Returns the time left on the sandbox's one wall-clock budget. */
function remainingSandboxBudgetMs(signal: AbortSignal): number {
  throwIfAborted(signal)
  const remainingMs = getRemainingExecutionMs(signal)
  if (remainingMs === undefined || remainingMs <= 0) {
    throw new DOMException('timeout', 'AbortError')
  }
  return Math.max(1, remainingMs)
}

/**
 * Rejects promptly when a sandbox budget expires even if the provider operation
 * currently in flight does not accept an AbortSignal. The operation remains
 * observed, and the lifecycle's abort binding tears down any sandbox it creates.
 */
function raceSandboxAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal))

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

async function withSandboxExecutionBudget<T>(
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  execute: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new DOMException('timeout', 'AbortError')
  }

  const controller = createTimeoutAbortController(timeoutMs, parentSignal)
  try {
    throwIfAborted(controller.signal)
    return await raceSandboxAbort(execute(controller.signal), controller.signal)
  } finally {
    controller.cleanup()
  }
}

function throwIfSandboxTimedOut(result: { timedOut?: boolean }): void {
  if (result.timedOut) throw new DOMException('timeout', 'AbortError')
}

function bindSandboxAbort(sandbox: SandboxHandle, signal?: AbortSignal) {
  let killed = false
  let killPromise: Promise<void> | null = null
  const provider = resolveProvider().id
  const kill = (reason: 'cleanup' | 'cancellation' | 'timeout'): Promise<void> => {
    if (killed) return Promise.resolve()
    if (!killPromise) {
      killPromise = sandbox
        .kill()
        .then(() => {
          killed = true
        })
        .catch((error) => {
          recordSandboxTeardownFailure({ provider, reason })
          logger.warn('Failed to tear down sandbox', {
            provider,
            sandboxId: sandbox.sandboxId,
            reason,
            error: getErrorMessage(error),
          })
          throw error
        })
        .finally(() => {
          if (!killed) killPromise = null
        })
    }
    return killPromise
  }
  const onAbort = () => {
    void kill(isTimeoutAbortReason(signal?.reason) ? 'timeout' : 'cancellation').catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  return {
    cleanup: async () => {
      try {
        await kill('cleanup')
      } catch {
        await kill('cleanup').catch(() => {})
      }
    },
    detach: () => signal?.removeEventListener('abort', onAbort),
  }
}

/**
 * Fetches one URL mount inside the sandbox, bounded by MAX_BYTES.
 *
 * Three mechanisms, because no one of them is sufficient on its own.
 * `--max-filesize` refuses an oversized object before a byte moves, but only when
 * the response declares a Content-Length — a chunked or length-less reply walks
 * straight past it. `head -c` therefore caps what can ever reach the disk at one
 * byte over the limit, so a mis-declared object cannot fill the sandbox while we
 * wait to notice. The final size check is what turns that truncated file into a
 * refusal rather than a silently corrupted mount.
 *
 * curl's exit status travels through a file because its status is lost in a
 * pipeline, and losing it would let a 403 on an expired URL look like a
 * successful empty download. The size check is consulted first: when `head`
 * closes the pipe early curl dies of EPIPE, and "over the limit" is the useful
 * message there, not the write error it provokes.
 *
 * MAX_BYTES, URL, DST, and DIR all arrive as environment variables, never
 * interpolated, so a presigned query string cannot break out of the command.
 */
const FETCH_URL_MOUNT_COMMAND = [
  'set -e',
  '[ -n "$DIR" ] && mkdir -p "$DIR"',
  'STATUS_FILE=$(mktemp)',
  'STATUS=0',
  '{ curl -fsS --retry 3 --retry-connrefused --max-time 300 --max-filesize "$MAX_BYTES" "$URL" || STATUS=$?; echo "$STATUS" > "$STATUS_FILE"; } | head -c "$(( MAX_BYTES + 1 ))" > "$DST"',
  'STATUS=$(cat "$STATUS_FILE")',
  'rm -f "$STATUS_FILE"',
  'SIZE=$(wc -c < "$DST")',
  'if [ "$SIZE" -gt "$MAX_BYTES" ]; then rm -f "$DST"; echo "mounted file exceeds the $MAX_BYTES byte limit" >&2; exit 1; fi',
  'if [ "$STATUS" -ne 0 ]; then rm -f "$DST"; echo "curl exited $STATUS" >&2; exit 1; fi',
].join('\n')

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
  opts: { rootUser?: boolean; signal: AbortSignal }
): Promise<void> {
  if (!files?.length) return
  const fetchedByUrl: string[] = []
  const writtenInline: string[] = []
  for (const file of files) {
    if (file.type === 'url') {
      const dir = file.path.slice(0, file.path.lastIndexOf('/'))
      let result: SandboxCommandResult
      try {
        result = await sandbox.runCommand(FETCH_URL_MOUNT_COMMAND, {
          envs: {
            URL: file.url,
            DST: file.path,
            DIR: dir,
            // Clamped, not just defaulted: `sandboxFiles` reaches this layer from
            // the request body, so a declared ceiling is a caller's number. It may
            // lower the limit for its own mount but never raise it past the one
            // this layer guarantees.
            MAX_BYTES: String(
              Math.min(file.maxBytes ?? MAX_SANDBOX_URL_MOUNT_BYTES, MAX_SANDBOX_URL_MOUNT_BYTES)
            ),
          },
          timeoutMs: Math.min(300_000, remainingSandboxBudgetMs(opts.signal)),
          maxOutputBytes: MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
          signal: opts.signal,
          rootUser: opts.rootUser,
        })
      } catch (error) {
        throwIfAborted(opts.signal)
        throw new Error(
          `Failed to fetch mounted file into sandbox at ${file.path}: ${getErrorMessage(error)}`
        )
      }
      throwIfAborted(opts.signal)
      throwIfSandboxTimedOut(result)
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
      remainingSandboxBudgetMs(opts.signal)
      writtenInline.push(file.path)
    } else {
      await sandbox.writeFile(file.path, file.content)
      remainingSandboxBudgetMs(opts.signal)
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

const PRIVATE_INPUT_ENVIRONMENT_VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Writes internal runtime payloads to generated paths after user-controlled
 * mounts have been materialized. The returned environment contains paths only.
 */
async function writeSandboxPrivateInputs(
  sandbox: SandboxHandle,
  inputs: SandboxPrivateInput[] | undefined,
  signal: AbortSignal
): Promise<Record<string, string>> {
  if (!inputs?.length) return {}
  throwIfAborted(signal)

  const seenEnvironmentVariables = new Set<string>()
  for (const input of inputs) {
    if (!PRIVATE_INPUT_ENVIRONMENT_VARIABLE_PATTERN.test(input.environmentVariable)) {
      throw new Error('Invalid private sandbox input environment variable')
    }
    if (seenEnvironmentVariables.has(input.environmentVariable)) {
      throw new Error('Duplicate private sandbox input environment variable')
    }
    seenEnvironmentVariables.add(input.environmentVariable)
  }

  const pathPrefix = `/tmp/.sim-private-input-${generateShortId(16)}`
  const environment: Record<string, string> = Object.create(null)
  for (let index = 0; index < inputs.length; index += 1) {
    throwIfAborted(signal)
    const input = inputs[index]
    const path = `${pathPrefix}-${index}`
    try {
      await sandbox.writeFile(path, input.content)
    } catch (error) {
      throwIfAborted(signal)
      throw error
    }
    throwIfAborted(signal)
    remainingSandboxBudgetMs(signal)
    environment[input.environmentVariable] = path
  }
  return environment
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
  maxBytes: number,
  options?: { signal?: AbortSignal }
): Promise<{ content: string; byteLength: number } | undefined> {
  try {
    return await sandbox.readFileWithLimit(outputSandboxPath, {
      maxBytes,
      encoding: shouldReadSandboxPathAsBase64(outputSandboxPath) ? 'base64' : 'utf8',
      signal: options?.signal,
    })
  } catch (error) {
    if (isSandboxOutputLimitError(error) || isSandboxOutputFileError(error)) throw error
    logger.warn('Failed to read requested sandbox output file', {
      sandboxId: sandbox.sandboxId,
    })
    return undefined
  }
}

async function inspectSandboxOutputFileSize(
  sandbox: SandboxHandle,
  outputSandboxPath: string
): Promise<number | undefined> {
  try {
    const size = await sandbox.getFileSize(outputSandboxPath)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('Sandbox returned an invalid output file size')
    }
    return size
  } catch (error) {
    if (isSandboxOutputLimitError(error) || isSandboxOutputFileError(error)) throw error
    logger.warn('Failed to inspect requested sandbox output file', {
      sandboxId: sandbox.sandboxId,
    })
    return undefined
  }
}

function requestedOutputSandboxPaths(req: {
  outputSandboxPath?: string
  outputSandboxPaths?: string[]
}): string[] {
  return [
    ...new Set([
      ...(req.outputSandboxPaths ?? []),
      ...(req.outputSandboxPath ? [req.outputSandboxPath] : []),
    ]),
  ]
}

/**
 * Enumerates the harvest directory, refusing anything it cannot return in full —
 * too many files, or nesting past what the listing reaches — before a single
 * byte is read. Sorted so a multi-file result is stable run to run rather than
 * inheriting whatever order the provider happened to return.
 */
async function listOutputDirectoryFiles(
  sandbox: SandboxHandle,
  outputSandboxDir: string,
  signal: AbortSignal
): Promise<SandboxDirectoryEntry[]> {
  let listed: SandboxDirectoryEntry[]
  try {
    listed = await sandbox.listFiles(outputSandboxDir, { depth: SANDBOX_OUTPUT_DIR_MAX_DEPTH })
  } catch (error) {
    // The directory is created before user code runs, so the only way it can be
    // missing now is that the code removed it. Providers report that as a raw
    // `lstat ... no such file or directory`, which reads like a Sim fault; say
    // what actually happened instead. Anything else propagates untouched rather
    // than being flattened into "produced nothing".
    if (/not_?found|no such file|ENOENT/i.test(getErrorMessage(error))) {
      throw new SandboxOutputDirectoryMissingError(outputSandboxDir)
    }
    throw error
  }
  const entries = listed.filter((entry) => entry.relativePath !== SANDBOX_OUTPUT_DIR_SENTINEL)
  remainingSandboxBudgetMs(signal)

  // A directory sitting exactly at the traversal limit still has unlisted
  // contents, and the providers report no truncation of their own. Refuse
  // rather than return a partial harvest: a file the code wrote and the caller
  // never receives is worse than an error naming the reason.
  const truncatedAt = entries.find(
    (entry) =>
      entry.kind === 'directory' &&
      entry.relativePath.split('/').length >= SANDBOX_OUTPUT_DIR_MAX_DEPTH
  )
  if (truncatedAt) {
    throw new SandboxOutputDepthError(
      `${outputSandboxDir}/${truncatedAt.relativePath}`,
      SANDBOX_OUTPUT_DIR_MAX_DEPTH
    )
  }

  const files = entries.filter((entry) => entry.kind === 'file')
  if (files.length > MAX_SANDBOX_OUTPUT_FILES) {
    throw new SandboxOutputFileCountError(files.length, outputSandboxDir)
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Brings the harvest directory into existence before user code runs.
 *
 * Owned here rather than by the caller's runtime prologue because
 * `outputSandboxDir` is this layer's contract: a caller that asks for a harvest
 * must not also have to know it is responsible for creating the directory, or
 * the first write in their code is ENOENT.
 */
async function ensureSandboxOutputDir(
  sandbox: SandboxHandle,
  outputSandboxDir: string | undefined,
  signal: AbortSignal
): Promise<void> {
  if (!outputSandboxDir) return
  await sandbox.writeFile(`${outputSandboxDir}/${SANDBOX_OUTPUT_DIR_SENTINEL}`, '')
  remainingSandboxBudgetMs(signal)
}

async function collectExportedFiles(
  sandbox: SandboxHandle,
  req: { outputSandboxPath?: string; outputSandboxPaths?: string[]; outputSandboxDir?: string },
  options: { signal: AbortSignal }
): Promise<{
  exportedFiles?: Record<string, string>
  exportedFileContent?: string
  collectedFiles?: SandboxCollectedFile[]
}> {
  const readablePaths: string[] = []
  let totalOutputBytes = 0
  for (const outputSandboxPath of requestedOutputSandboxPaths(req)) {
    const size = await inspectSandboxOutputFileSize(sandbox, outputSandboxPath)
    remainingSandboxBudgetMs(options.signal)
    if (size === undefined) continue
    totalOutputBytes += size
    if (totalOutputBytes > MAX_SANDBOX_OUTPUT_BYTES) {
      throw new SandboxOutputLimitError(totalOutputBytes)
    }
    readablePaths.push(outputSandboxPath)
  }

  // Sized into the same running total as the declared paths, so an execution
  // cannot spend the ceiling twice by both declaring and harvesting. A declared
  // path that happens to sit inside the harvest directory is dropped from the
  // discovered set rather than counted again — double-billing it would reject a
  // single output larger than half the ceiling as oversized.
  const declaredPaths = new Set(readablePaths)
  const discovered = (
    req.outputSandboxDir
      ? await listOutputDirectoryFiles(sandbox, req.outputSandboxDir, options.signal)
      : []
  ).filter((entry) => !declaredPaths.has(entry.path))
  for (const entry of discovered) {
    totalOutputBytes += entry.size
    if (totalOutputBytes > MAX_SANDBOX_OUTPUT_BYTES) {
      throw new SandboxOutputLimitError(totalOutputBytes)
    }
  }

  const exportedFiles: Record<string, string> = {}
  let readOutputBytes = 0
  for (const outputSandboxPath of readablePaths) {
    try {
      const file = await readSandboxOutputFile(
        sandbox,
        outputSandboxPath,
        MAX_SANDBOX_OUTPUT_BYTES - readOutputBytes,
        options
      )
      if (file !== undefined) {
        remainingSandboxBudgetMs(options.signal)
        readOutputBytes += file.byteLength
        exportedFiles[outputSandboxPath] = file.content
      }
    } catch (error) {
      if (isSandboxOutputLimitError(error)) {
        throw new SandboxOutputLimitError(
          readOutputBytes + error.attemptedBytes,
          MAX_SANDBOX_OUTPUT_BYTES
        )
      }
      throw error
    }
  }

  const collectedFiles: SandboxCollectedFile[] = []
  for (const entry of discovered) {
    try {
      // Always base64: a harvested filename is arbitrary, and the extension
      // allowlist that picks an encoding for a declared path would decode a
      // `.parquet` or an extensionless binary as utf8 — substituting U+FFFD and
      // delivering corruption that still looks like a valid file.
      const file = await sandbox.readFileWithLimit(entry.path, {
        maxBytes: MAX_SANDBOX_OUTPUT_BYTES - readOutputBytes,
        encoding: 'base64',
        signal: options.signal,
      })
      remainingSandboxBudgetMs(options.signal)
      readOutputBytes += file.byteLength
      collectedFiles.push({
        path: entry.path,
        relativePath: entry.relativePath,
        contentBase64: file.content,
        byteLength: file.byteLength,
      })
    } catch (error) {
      if (isSandboxOutputLimitError(error)) {
        throw new SandboxOutputLimitError(
          readOutputBytes + error.attemptedBytes,
          MAX_SANDBOX_OUTPUT_BYTES
        )
      }
      // Unlike a declared path, a harvested file was just observed to exist, so
      // a failed read is an anomaly rather than a caller mistake. Dropping it
      // would silently lose output the code successfully produced.
      throw error
    }
  }

  return {
    exportedFileContent: req.outputSandboxPath ? exportedFiles[req.outputSandboxPath] : undefined,
    exportedFiles: Object.keys(exportedFiles).length ? exportedFiles : undefined,
    collectedFiles: collectedFiles.length ? collectedFiles : undefined,
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
 * Held back from the code's own budget when an execution will export files.
 *
 * The export runs after the code succeeds and draws on the same wall clock, so
 * without a reserve a long install plus long-running code can time out during
 * the read — destroying work the code already finished, under an error that
 * only says "timeout".
 */
const MIN_EXPORT_BUDGET_MS = 10_000

/**
 * The budget handed to user code, less an export reserve when this request will
 * read files back. Short budgets are left alone: taking the reserve out of one
 * would starve the code to buy time for an export it never reaches.
 */
function codeBudgetMs(
  req: { outputSandboxPath?: string; outputSandboxPaths?: string[]; outputSandboxDir?: string },
  signal: AbortSignal
): number {
  const remainingMs = remainingSandboxBudgetMs(signal)
  const exportsFiles = Boolean(
    req.outputSandboxDir || req.outputSandboxPath || req.outputSandboxPaths?.length
  )
  if (!exportsFiles || remainingMs <= MIN_EXPORT_BUDGET_MS * 2) return remainingMs
  return remainingMs - MIN_EXPORT_BUDGET_MS
}

/**
 * Installs a runtime sandbox's dependencies out of the caller's budget and
 * uses the shared wall-clock budget, so creation and every later phase consume
 * the same deadline rather than receiving independent timeout allowances.
 */
async function provisionWithinBudget(
  sandbox: SandboxHandle,
  selected: ResolvedSandbox | null,
  signal: AbortSignal
): Promise<void> {
  if (!selected) return
  try {
    await provisionRuntimeDependencies(sandbox, selected, {
      timeoutMs: installBudgetMs(remainingSandboxBudgetMs(signal)),
      signal,
    })
  } catch (error) {
    throwIfAborted(signal)
    throw error
  }
  throwIfAborted(signal)
}

async function executeInSandboxWithinBudget(
  req: SandboxExecutionRequest
): Promise<SandboxExecutionResult> {
  const { code, language } = req
  const signal = req.signal as AbortSignal
  const kind = req.sandboxKind ?? 'code'
  throwIfAborted(signal)

  // Resolved before the sandbox is created so a selection that cannot be honored
  // fails without spending a provider create.
  const selected = await resolveWorkspaceSandbox({
    kind,
    language,
    workspaceId: req.workspaceId,
    sandboxId: req.sandboxId,
  })
  throwIfAborted(signal)

  const sandbox = await createSelectedSandbox(
    kind,
    {
      language,
      imageRef: selected?.imageRef,
      lifetimeMs: remainingSandboxBudgetMs(signal),
    },
    selected,
    signal
  )
  const sandboxId = sandbox.sandboxId
  const abortBinding = bindSandboxAbort(sandbox, signal)

  try {
    throwIfAborted(signal)
    // Inside the try so a failed install or mount still kills the sandbox via the
    // finally below. Dependencies land before the inputs so user code and its
    // mounts always see a complete environment.
    //
    await provisionWithinBudget(sandbox, selected, signal)
    await writeSandboxInputs(sandbox, req.sandboxFiles, { signal })
    await ensureSandboxOutputDir(sandbox, req.outputSandboxDir, signal)
    const privateInputEnvironment = await writeSandboxPrivateInputs(
      sandbox,
      req.privateInputs,
      signal
    )
    const executionEnvironment = {
      ...selected?.envs,
      ...privateInputEnvironment,
    }
    const hasExecutionEnvironment =
      selected?.envs !== undefined || Object.keys(privateInputEnvironment).length > 0

    let execution: SandboxCodeResult
    try {
      execution = await sandbox.runCode(code, {
        timeoutMs: codeBudgetMs(req, signal),
        javascriptPreload: buildJavaScriptRuntimeBindingsSource(req.runtimeBindings ?? []),
        maxOutputBytes: MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
        signal,
        ...(hasExecutionEnvironment ? { envs: executionEnvironment } : {}),
      })
    } catch (error) {
      throwIfAborted(signal)
      throw error
    }
    throwIfAborted(signal)
    throwIfSandboxTimedOut(execution)

    if (execution.error) {
      const errorMessage = `${execution.error.name}: ${execution.error.value}`
      logger.error('Sandbox execution failed', {
        sandboxId,
        hasTraceback: Boolean(execution.error.traceback),
      })
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

    const { exportedFiles, exportedFileContent, collectedFiles } = await collectExportedFiles(
      sandbox,
      req,
      { signal }
    )
    throwIfAborted(signal)

    return {
      result: extraction.result,
      stdout: cleanedStdout,
      sandboxId,
      exportedFileContent,
      exportedFiles,
      collectedFiles,
    }
  } finally {
    abortBinding.detach()
    await abortBinding.cleanup()
  }
}

export function executeInSandbox(req: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
  return withSandboxExecutionBudget(req.timeoutMs, req.signal, (signal) =>
    executeInSandboxWithinBudget({ ...req, signal })
  )
}

async function executeShellInSandboxWithinBudget(
  req: SandboxShellExecutionRequest
): Promise<SandboxExecutionResult> {
  const { code, envs } = req
  const signal = req.signal as AbortSignal
  const kind = req.sandboxKind ?? 'shell'
  throwIfAborted(signal)

  // No language is passed: a shell execution runs commands rather than a language
  // runtime, so whichever language the sandbox carries is the one it installs.
  const selected = await resolveWorkspaceSandbox({
    kind,
    workspaceId: req.workspaceId,
    sandboxId: req.sandboxId,
  })
  throwIfAborted(signal)

  const sandbox = await createSelectedSandbox(
    kind,
    { imageRef: selected?.imageRef, lifetimeMs: remainingSandboxBudgetMs(signal) },
    selected,
    signal
  )
  const sandboxId = sandbox.sandboxId
  const abortBinding = bindSandboxAbort(sandbox, signal)

  try {
    throwIfAborted(signal)
    // Inside the try so a failed install or mount still kills the sandbox via the
    // finally below. The install shares the caller's budget rather than adding to
    // it — see the note in `executeInSandbox`.
    await provisionWithinBudget(sandbox, selected, signal)
    await writeSandboxInputs(sandbox, req.sandboxFiles, {
      rootUser: true,
      signal,
    })
    await ensureSandboxOutputDir(sandbox, req.outputSandboxDir, signal)
    const privateInputEnvironment = await writeSandboxPrivateInputs(
      sandbox,
      req.privateInputs,
      signal
    )

    let result: SandboxCommandResult
    try {
      result = await sandbox.runCommand(code, {
        envs: {
          ...selected?.envs,
          ...envs,
          PATH: selected?.envs?.PATH ?? SANDBOX_SYSTEM_PATH,
          ...privateInputEnvironment,
        },
        timeoutMs: codeBudgetMs(req, signal),
        maxOutputBytes: MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
        signal,
        rootUser: true,
        atMostOnce: true,
      })
    } catch (error) {
      throwIfAborted(signal)
      throw error
    }
    throwIfAborted(signal)
    throwIfSandboxTimedOut(result)

    const stdout = [result.stdout, result.stderr].filter(Boolean).join('\n')

    if (result.exitCode !== 0) {
      // Daytona merges both streams into stdout (stderr is always empty), so fall
      // back to stdout for the real command output before the generic message.
      const errorMessage =
        result.stderr || result.stdout || `Process exited with code ${result.exitCode}`
      logger.error('Sandbox shell execution error', {
        sandboxId,
        exitCode: result.exitCode,
      })
      return { result: null, stdout, error: errorMessage, sandboxId }
    }

    // Shell scripts have no wrapper: any __SIM_RESULT__ line is user-authored
    // (e.g. `echo "__SIM_RESULT__=$STATUS"`), so a non-JSON payload is a plain
    // string result, not transport corruption.
    const extraction = extractSimResult(stdout)
    const parsed = extraction.parseFailed ? extraction.rawPayload : extraction.result

    const { exportedFiles, exportedFileContent, collectedFiles } = await collectExportedFiles(
      sandbox,
      req,
      { signal }
    )
    throwIfAborted(signal)

    return {
      result: parsed,
      stdout: extraction.cleanedStdout,
      sandboxId,
      exportedFileContent,
      exportedFiles,
      collectedFiles,
    }
  } finally {
    abortBinding.detach()
    await abortBinding.cleanup()
  }
}

export function executeShellInSandbox(
  req: SandboxShellExecutionRequest
): Promise<SandboxExecutionResult> {
  return withSandboxExecutionBudget(req.timeoutMs, req.signal, (signal) =>
    executeShellInSandboxWithinBudget({ ...req, signal })
  )
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
        maxOutputBytes: MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
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
    } catch {
      await sandbox.kill().catch(() => {})
    }
  }
}
