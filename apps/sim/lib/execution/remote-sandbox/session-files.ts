import { posix } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { prepareSandboxSessionAccess } from '@/lib/execution/remote-sandbox/execution-observer'
import { withSandboxFilePublication } from '@/lib/execution/remote-sandbox/file-publication'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import {
  ensureSessionSandbox,
  SESSION_SANDBOX_IDLE_MS,
} from '@/lib/execution/remote-sandbox/session'
import { withSandboxSessionLock } from '@/lib/execution/remote-sandbox/session-lock'

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
  content: string | Uint8Array,
  abortSignal?: AbortSignal,
  options: { overwrite: boolean } = { overwrite: true }
): Promise<SessionFileWrite> {
  try {
    const resolved = resolveSessionPath(path)
    const deadline = AbortSignal.timeout(30_000)
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
        { overwrite: options.overwrite, signal, timeoutMs: 30_000, rootUser: false },
        (staged) =>
          sandbox.writeFile(
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
  }
}
