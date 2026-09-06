import { posix } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { prepareSandboxSessionAccess } from '@/lib/execution/remote-sandbox/execution-observer'
import { withSandboxFilePublication } from '@/lib/execution/remote-sandbox/file-publication'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import {
  ensureSessionSandbox,
  SESSION_SANDBOX_IDLE_MS,
} from '@/lib/execution/remote-sandbox/session'
import { withSandboxSessionLock } from '@/lib/execution/remote-sandbox/session-lock'
import type { SandboxHandle } from '@/lib/execution/remote-sandbox/types'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'

const logger = createLogger('SessionSandboxFiles')

/**
 * File I/O against the chat's session sandbox — the bridge that lets the
 * Mothership's embedded CLI treat the chat's workbench as its filesystem:
 * `@path` arguments read from it, `outputFile` writes command output into it,
 * while the CLI itself keeps executing in-process on the server. An explicit
 * write can create the machine; a missing read never creates an empty replacement.
 *
 * Session sandboxes exist only on providers with session support (E2B), whose
 * mothership image runs the default user at this home directory — the pinned
 * cwd contract for relative paths.
 */
export const SESSION_SANDBOX_HOME = '/home/user'

const READ_LIMIT_BYTES = 4 * 1024 * 1024
const FILE_TRANSFER_TIMEOUT_MS = 10 * 60_000

export function resolveSessionPath(path: string): string {
  if (!path || path.includes('\0')) throw new Error('A nonempty sandbox path is required')
  return posix.resolve(SESSION_SANDBOX_HOME, path)
}

export type SessionFileRead =
  | { outcome: 'read'; content: string }
  | { outcome: 'no-session' }
  | { outcome: 'no-file'; detail: string }
  | { outcome: 'error'; detail: string }

export async function readSessionSandboxFile(
  sessionKey: string,
  path: string,
  encoding: 'utf8' | 'base64' = 'utf8',
  abortSignal?: AbortSignal
): Promise<SessionFileRead> {
  try {
    const resolved = resolveSessionPath(path)
    const deadline = AbortSignal.timeout(30_000)
    const accessSignal = abortSignal ? AbortSignal.any([abortSignal, deadline]) : deadline
    await prepareSandboxSessionAccess(sessionKey, accessSignal)
    return await withSandboxSessionLock(sessionKey, accessSignal, async (signal) => {
      const provider = resolveProvider()
      const sandbox = await provider.findSessionSandbox?.(sessionKey, {})
      signal.throwIfAborted()
      if (!sandbox) return { outcome: 'no-session' }
      await sandbox.extendLifetime?.(SESSION_SANDBOX_IDLE_MS)
      signal.throwIfAborted()
      try {
        const file = await sandbox.readFileWithLimit(resolved, {
          maxBytes: READ_LIMIT_BYTES,
          encoding,
          signal,
        })
        return { outcome: 'read', content: file.content }
      } catch (error) {
        return { outcome: 'no-file', detail: getErrorMessage(error) }
      }
    })
  } catch (error) {
    return { outcome: 'error', detail: getErrorMessage(error) }
  }
}

export type SessionFileWrite =
  | { outcome: 'written'; path: string }
  | { outcome: 'error'; detail: string }

export async function writeSessionSandboxFile(
  sessionKey: string,
  path: string,
  content: string | Uint8Array | ReadableStream<Uint8Array>,
  abortSignal?: AbortSignal,
  options: { overwrite: boolean } = { overwrite: true }
): Promise<SessionFileWrite> {
  try {
    const resolved = resolveSessionPath(path)
    const timeoutMs = content instanceof ReadableStream ? FILE_TRANSFER_TIMEOUT_MS : 30_000
    const deadline = AbortSignal.timeout(timeoutMs)
    const accessSignal = abortSignal ? AbortSignal.any([abortSignal, deadline]) : deadline
    await prepareSandboxSessionAccess(sessionKey, accessSignal)
    return await withSandboxSessionLock(sessionKey, accessSignal, async (signal) => {
      const provider = resolveProvider()
      const { created } = await ensureSessionSandbox({
        provider,
        kind: 'mothership',
        options: {},
        selected: null,
        session: { key: sessionKey },
        signal,
        bootstrapTimeoutMs: 30_000,
      })
      const sandbox = created.sandbox
      await withSandboxFilePublication(
        sandbox,
        resolved,
        { overwrite: options.overwrite, signal, timeoutMs, rootUser: false },
        (staged) =>
          content instanceof ReadableStream
            ? streamSessionFile(sandbox, staged, content, signal)
            : sandbox.writeFile(
                staged,
                typeof content === 'string' ? content : new Uint8Array(content).buffer
              )
      )
      return { outcome: 'written', path: resolved }
    })
  } catch (error) {
    // This may follow a successful CLI mutation. Report the file failure separately so it is not repeated.
    logger.warn('Session sandbox file write failed', { sessionKey, error: getErrorMessage(error) })
    return { outcome: 'error', detail: getErrorMessage(error) }
  } finally {
    if (content instanceof ReadableStream) await content.cancel().catch(() => {})
  }
}

/** Keep only queued chunks in memory and reject partial transfers before publication. */
async function streamSessionFile(
  sandbox: SandboxHandle,
  staged: string,
  content: ReadableStream<Uint8Array>,
  signal: AbortSignal
): Promise<void> {
  if (!sandbox.writeFileStream) throw new Error('This workbench does not support file streaming')
  const stopped = new AbortController()
  const transferSignal = AbortSignal.any([signal, stopped.signal])
  let bytes = 0
  let complete = false
  let abortTransfer = () => {}
  const bounded = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      abortTransfer = () => controller.error(transferSignal.reason)
    },
    transform(chunk, controller) {
      bytes += chunk.byteLength
      if (bytes > MAX_WORKSPACE_FILE_SIZE) {
        throw new PayloadSizeLimitError({
          label: 'Workbench file',
          maxBytes: MAX_WORKSPACE_FILE_SIZE,
          observedBytes: bytes,
        })
      }
      controller.enqueue(chunk)
    },
    flush() {
      complete = true
    },
  })
  transferSignal.addEventListener('abort', abortTransfer, { once: true })
  if (transferSignal.aborted) abortTransfer()
  const copying = content.pipeTo(bounded.writable, { signal: transferSignal })
  /** The provider may reject before it consumes the body; keep both failure paths observed. */
  void copying.catch(() => {})
  try {
    await sandbox.writeFileStream(staged, bounded.readable, { signal: transferSignal })
    signal.throwIfAborted()
    if (!complete) throw new Error('Workbench transfer ended before the complete file was written')
    await copying
  } finally {
    stopped.abort()
    await copying.catch(() => {})
    transferSignal.removeEventListener('abort', abortTransfer)
  }
}
