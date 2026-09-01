import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'

const logger = createLogger('SessionSandboxFiles')

/**
 * File I/O against an EXISTING session sandbox — the bridge that lets the
 * Mothership's embedded CLI treat the chat's workbench as its filesystem:
 * `@path` arguments read from it, `outputFile` writes command output into it,
 * while the CLI itself keeps executing in-process on the server. Find-only by
 * design: booting the machine belongs to the execution path (run_code), so a
 * missing session degrades to an actionable answer instead of paying a sandbox
 * spin-up inside a CLI call.
 *
 * Session sandboxes exist only on providers with session support (E2B), whose
 * mothership image runs the default user at this home directory — the pinned
 * cwd contract for relative paths.
 */
export const SESSION_SANDBOX_HOME = '/home/user'

const READ_LIMIT_BYTES = 4 * 1024 * 1024

export function resolveSessionPath(path: string): string {
  return path.startsWith('/') ? path : `${SESSION_SANDBOX_HOME}/${path}`
}

export type SessionFileRead =
  | { outcome: 'read'; content: string }
  | { outcome: 'no-session' }
  | { outcome: 'no-file'; detail: string }

export async function readSessionSandboxFile(
  sessionKey: string,
  path: string
): Promise<SessionFileRead> {
  const provider = resolveProvider()
  if (!provider.findSessionSandbox) return { outcome: 'no-session' }
  let sandbox: Awaited<ReturnType<NonNullable<typeof provider.findSessionSandbox>>>
  try {
    sandbox = await provider.findSessionSandbox(sessionKey, {})
  } catch (error) {
    logger.warn('Session sandbox lookup failed for file read', {
      sessionKey,
      error: getErrorMessage(error),
    })
    return { outcome: 'no-session' }
  }
  if (!sandbox) return { outcome: 'no-session' }
  try {
    const file = await sandbox.readFileWithLimit(resolveSessionPath(path), {
      maxBytes: READ_LIMIT_BYTES,
      encoding: 'utf8',
    })
    return { outcome: 'read', content: file.content }
  } catch (error) {
    return { outcome: 'no-file', detail: getErrorMessage(error) }
  }
}

export type SessionFileWrite =
  | { outcome: 'written'; path: string }
  | { outcome: 'no-session' }
  | { outcome: 'error'; detail: string }

export async function writeSessionSandboxFile(
  sessionKey: string,
  path: string,
  content: string
): Promise<SessionFileWrite> {
  const provider = resolveProvider()
  if (!provider.findSessionSandbox) return { outcome: 'no-session' }
  let sandbox: Awaited<ReturnType<NonNullable<typeof provider.findSessionSandbox>>>
  try {
    sandbox = await provider.findSessionSandbox(sessionKey, {})
  } catch (error) {
    logger.warn('Session sandbox lookup failed for file write', {
      sessionKey,
      error: getErrorMessage(error),
    })
    return { outcome: 'no-session' }
  }
  if (!sandbox) return { outcome: 'no-session' }
  const resolved = resolveSessionPath(path)
  try {
    await sandbox.writeFile(resolved, content)
  } catch (error) {
    // A failed write must degrade, never throw: the CLI invocation it follows
    // already ran — possibly a mutation — and an escaping error here would
    // report that successful call as failed and invite a repeating retry.
    logger.warn('Session sandbox file write failed', {
      sessionKey,
      path: resolved,
      error: getErrorMessage(error),
    })
    return { outcome: 'error', detail: getErrorMessage(error) }
  }
  return { outcome: 'written', path: resolved }
}
