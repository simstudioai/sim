import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import type { EmbeddedFileSnapshot } from 'sim/embed'
import { prepareSandboxSessionAccess } from '@/lib/execution/remote-sandbox/execution-observer'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import { SESSION_SANDBOX_IDLE_MS } from '@/lib/execution/remote-sandbox/session'
import { resolveSessionPath } from '@/lib/execution/remote-sandbox/session-files'
import { withSandboxSessionLock } from '@/lib/execution/remote-sandbox/session-lock'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'

const logger = createLogger('SessionFileSnapshot')
const SNAPSHOT_TIMEOUT_MS = 10 * 60_000

/** Copy once on the workbench; metadata and every upload part then refer to these exact bytes. */
const COPY_FILE = `python3 - <<'SIM_UPLOAD_SNAPSHOT'
import os, stat
source = os.environ['SIM_UPLOAD_SOURCE']
target = os.environ['SIM_UPLOAD_SNAPSHOT']
limit = int(os.environ['SIM_UPLOAD_MAX_BYTES'])
fd = os.open(source, os.O_RDONLY | os.O_NONBLOCK)
with os.fdopen(fd, 'rb') as reader:
    info = os.fstat(reader.fileno())
    if not stat.S_ISREG(info.st_mode):
        raise ValueError('Upload source must be a regular file')
    if info.st_size > limit:
        raise ValueError('Upload source exceeds the workspace file size limit')
    with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as writer:
        size = 0
        while True:
            chunk = reader.read(min(1024 * 1024, limit - size + 1))
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise ValueError('Upload source exceeds the workspace file size limit')
            writer.write(chunk)
SIM_UPLOAD_SNAPSHOT`

/** Only the existing chat machine may supply an upload; a missing read never allocates one. */
export async function openSessionFileSnapshot(
  sessionKey: string,
  path: string,
  abortSignal?: AbortSignal
): Promise<EmbeddedFileSnapshot> {
  const source = resolveSessionPath(path)
  const stopped = new AbortController()
  const signals = [stopped.signal, AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS)]
  if (abortSignal) signals.push(abortSignal)
  const signal = AbortSignal.any(signals)
  await prepareSandboxSessionAccess(sessionKey, signal)
  let snapshot: EmbeddedFileSnapshot | undefined
  try {
    return await withSandboxSessionLock(sessionKey, signal, async (accessSignal) => {
      const sandbox = await resolveProvider().findSessionSandbox?.(sessionKey, {})
      accessSignal.throwIfAborted()
      if (!sandbox) throw new Error(`No workbench exists for this chat; write "${path}" first.`)
      const readStream = sandbox.readFileStream?.bind(sandbox)
      if (!readStream) throw new Error('This workbench does not support file streaming')
      const staged = `/tmp/.sim-upload-${generateShortId(16)}`
      let stream: ReadableStream<Uint8Array> | undefined
      let opened = false
      let disposed: Promise<void> | undefined
      const dispose = () => {
        disposed ??= (async () => {
          stopped.abort()
          await stream?.cancel().catch(() => {})
          await sandbox.removeFile(staged).catch((error: unknown) => {
            logger.warn('Upload snapshot cleanup failed; the workbench retains temporary bytes', {
              sessionKey,
              error,
            })
          })
        })()
        return disposed
      }
      try {
        await sandbox.extendLifetime?.(SESSION_SANDBOX_IDLE_MS)
        accessSignal.throwIfAborted()
        const copied = await sandbox.runCommand(COPY_FILE, {
          envs: {
            SIM_UPLOAD_SOURCE: source,
            SIM_UPLOAD_SNAPSHOT: staged,
            SIM_UPLOAD_MAX_BYTES: String(MAX_WORKSPACE_FILE_SIZE),
          },
          signal: accessSignal,
          timeoutMs: SNAPSHOT_TIMEOUT_MS,
          maxOutputBytes: 64 * 1024,
          atMostOnce: true,
          rootUser: false,
        })
        accessSignal.throwIfAborted()
        if (copied.timedOut) throw new Error('Workbench upload snapshot timed out')
        if (copied.exitCode !== 0) {
          throw new Error(copied.stderr.trim() || 'Could not prepare the workbench upload file')
        }
        const size = await sandbox.getFileSize(staged)
        accessSignal.throwIfAborted()
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_WORKSPACE_FILE_SIZE) {
          throw new Error('Invalid workbench upload snapshot size')
        }
        snapshot = {
          size,
          stream: async () => {
            signal.throwIfAborted()
            if (opened) throw new Error('The workbench upload snapshot has already been consumed')
            opened = true
            stream = await readStream(staged, { signal })
            if (signal.aborted) {
              await stream.cancel().catch(() => {})
              signal.throwIfAborted()
            }
            return stream
          },
          dispose,
        }
        return snapshot
      } catch (error) {
        await dispose()
        throw error
      }
    })
  } catch (error) {
    /** A lease can fail after the callback returns but before the snapshot reaches its caller. */
    await snapshot?.dispose()
    throw error
  }
}
