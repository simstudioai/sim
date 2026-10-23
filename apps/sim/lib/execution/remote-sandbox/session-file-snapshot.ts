import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import type { EmbeddedFileSnapshot } from 'sim/embed'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { prepareSandboxSessionAccess } from '@/lib/execution/remote-sandbox/observer'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import { SESSION_SANDBOX_IDLE_MS } from '@/lib/execution/remote-sandbox/session'
import type { SessionFileObserver } from '@/lib/execution/remote-sandbox/session-file-observer'
import { resolveSessionPath } from '@/lib/execution/remote-sandbox/session-files'
import { withSandboxSessionLock } from '@/lib/execution/remote-sandbox/session-lock'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'

const logger = createLogger('SessionFileSnapshot')
const SNAPSHOT_TIMEOUT_MS = 10 * 60_000

const FAILURE_MARKER = 'SIM_SNAPSHOT_FAILURE'

/**
 * Copy once on the workbench; metadata and every upload part then refer to these exact bytes.
 * A failure prints one marker line naming a reason from a closed set (plus the exception class
 * when unclassified) and never raw stderr, which can echo workbench paths and contents. Once
 * staging begins, only a full disk is classified: an unwritable staging file says nothing about
 * the requested source.
 */
const COPY_FILE = `python3 - <<'SIM_UPLOAD_SNAPSHOT'
import errno, json, os, stat, sys
def fail(reason, detail=''):
    print('${FAILURE_MARKER} ' + reason + (' ' + detail if detail else ''))
    sys.exit(3)
SOURCE_REASONS = {errno.ENOENT: 'not_found', errno.ENOTDIR: 'not_found',
                  errno.EISDIR: 'not_regular', errno.ENXIO: 'not_regular',
                  errno.EACCES: 'permission', errno.EPERM: 'permission'}
STAGING_REASONS = {errno.ENOSPC: 'no_space', errno.EDQUOT: 'no_space'}
reasons = SOURCE_REASONS
try:
    source = os.path.realpath(os.environ['SIM_UPLOAD_SOURCE'])
    roots = json.loads(os.environ.get('SIM_UPLOAD_ALLOWED_ROOTS', '[]'))
    if roots and not any(source.startswith(root + '/') for root in roots):
        fail('outside_roots')
    target = os.environ['SIM_UPLOAD_SNAPSHOT']
    limit = int(os.environ['SIM_UPLOAD_MAX_BYTES'])
    fd = os.open(source, os.O_RDONLY | os.O_NONBLOCK)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        fail('not_regular')
    if info.st_size > limit:
        fail('too_large')
    reasons = STAGING_REASONS
    with os.fdopen(fd, 'rb') as reader, os.fdopen(
        os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb'
    ) as writer:
        size = 0
        while True:
            chunk = reader.read(min(1024 * 1024, limit - size + 1))
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                fail('too_large')
            writer.write(chunk)
except Exception as error:
    fail(reasons.get(getattr(error, 'errno', None), 'unknown'), type(error).__name__)
SIM_UPLOAD_SNAPSHOT`

const FAILURE_LINE = new RegExp(`^${FAILURE_MARKER} ([a-z_]+)(?: ([A-Za-z][A-Za-z0-9_]*))?$`, 'm')

/** Maps the copy script's closed failure set to caller-fixable errors the model can act on. */
function snapshotFailure(
  copied: { exitCode: number; stdout: string },
  path: string,
  maxBytes: number
): Error {
  const [, reason, exceptionClass] = FAILURE_LINE.exec(copied.stdout) ?? []
  switch (reason) {
    case 'not_found':
      return new OrchestrationError(
        'not_found',
        `No file exists at ${path} on this chat's workbench. Check the path, or wait for the step that writes it to finish.`
      )
    case 'not_regular':
      return new OrchestrationError(
        'validation',
        `${path} is not a regular file on this chat's workbench (it may be a directory). Use a file inside it instead.`
      )
    case 'permission':
      return new OrchestrationError(
        'forbidden',
        `The workbench user does not have permission to read ${path}.`
      )
    case 'outside_roots':
      return new OrchestrationError(
        'forbidden',
        `${path} resolves outside the permitted workbench directories.`
      )
    case 'too_large':
      return new OrchestrationError(
        'payload_too_large',
        `${path} exceeds the ${maxBytes}-byte size limit.`
      )
    case 'no_space':
      return new OrchestrationError(
        'conflict',
        "This chat's workbench is out of disk space. Delete files it no longer needs, then retry."
      )
    default:
      return new Error(
        `Could not prepare the workbench upload file (exit ${copied.exitCode}${exceptionClass ? `, ${exceptionClass}` : ''})`
      )
  }
}

/** Only the existing chat machine may supply an upload; a missing read never allocates one. */
export async function openSessionFileSnapshot(
  sessionKey: string,
  path: string,
  abortSignal?: AbortSignal,
  observe?: SessionFileObserver,
  options?: { allowedRoots?: readonly string[]; maxBytes?: number }
): Promise<EmbeddedFileSnapshot> {
  const source = resolveSessionPath(path)
  const maxBytes = options?.maxBytes ?? MAX_WORKSPACE_FILE_SIZE
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_WORKSPACE_FILE_SIZE)
    throw new Error('Invalid workbench snapshot byte limit')
  const stopped = new AbortController()
  const signals = [stopped.signal, AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS)]
  if (abortSignal) signals.push(abortSignal)
  const signal = AbortSignal.any(signals)
  await prepareSandboxSessionAccess(sessionKey, signal)
  let snapshot: EmbeddedFileSnapshot | undefined
  try {
    return await withSandboxSessionLock(sessionKey, signal, async (accessSignal) => {
      const provider = resolveProvider()
      // The reconnect grants the idle lease itself, so it can reset a workbench near its runtime cap.
      const sandbox = await provider.findSessionSandbox?.(sessionKey, {
        lifetimeMs: SESSION_SANDBOX_IDLE_MS,
      })
      accessSignal.throwIfAborted()
      if (!sandbox)
        throw new OrchestrationError(
          'not_found',
          `No workbench exists for this chat; write "${path}" first.`
        )
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
        accessSignal.throwIfAborted()
        const copied = await sandbox.runCommand(COPY_FILE, {
          envs: {
            SIM_UPLOAD_SOURCE: source,
            SIM_UPLOAD_ALLOWED_ROOTS: JSON.stringify(options?.allowedRoots ?? []),
            SIM_UPLOAD_SNAPSHOT: staged,
            SIM_UPLOAD_MAX_BYTES: String(maxBytes),
          },
          signal: accessSignal,
          timeoutMs: SNAPSHOT_TIMEOUT_MS,
          maxOutputBytes: 64 * 1024,
          atMostOnce: true,
          rootUser: false,
        })
        accessSignal.throwIfAborted()
        if (copied.timedOut) throw new Error('Workbench upload snapshot timed out')
        if (copied.exitCode !== 0) throw snapshotFailure(copied, path, maxBytes)
        const size = await sandbox.getFileSize(staged)
        accessSignal.throwIfAborted()
        if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
          throw new Error('Invalid workbench upload snapshot size')
        }
        snapshot = {
          size,
          signal,
          stream: async () => {
            signal.throwIfAborted()
            if (opened) throw new Error('The workbench upload snapshot has already been consumed')
            opened = true
            stream = await readStream(staged, { signal })
            if (observe) {
              stream = observe({ providerId: provider.id, sandboxId: sandbox.sandboxId }, stream)
            }
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
