import { posix } from 'node:path'
import { generateShortId } from '@sim/utils/id'
import type { SandboxHandle } from '@/lib/execution/remote-sandbox/types'

/** Publish on the same filesystem: link refuses collisions, replace swaps complete bytes atomically. */
const PUBLISH_FILE_COMMAND = `python3 - <<'SIM_PUBLISH_FILE'
import errno, os, sys
source = os.environ['SIM_FILE_STAGE']
target = os.environ['SIM_FILE_TARGET']
try:
    if os.environ.get('SIM_FILE_EXECUTABLE') == '1':
        os.chmod(source, 0o755)
    if os.environ['SIM_FILE_OVERWRITE'] == '1':
        visited = set()
        while os.environ.get('SIM_FILE_FOLLOW_SYMLINKS') != '0' and os.path.islink(target):
            absolute = os.path.abspath(target)
            if absolute in visited:
                raise OSError(errno.ELOOP, 'Symbolic link loop')
            visited.add(absolute)
            target = os.path.abspath(os.path.join(os.path.dirname(target), os.readlink(target)))
        os.replace(source, target)
    else:
        os.link(source, target)
except FileExistsError:
    print('Destination already exists; use --force to overwrite it.', file=sys.stderr)
    sys.exit(1)
finally:
    if os.path.exists(source):
        os.unlink(source)
SIM_PUBLISH_FILE`

/** Transfers land beside the target; concurrent readers see complete old or new bytes. */
export async function withSandboxFilePublication(
  sandbox: SandboxHandle,
  path: string,
  options: {
    overwrite: boolean
    signal: AbortSignal
    timeoutMs: number
    rootUser?: boolean
    executable?: boolean
    followSymlinks?: boolean
  },
  materialize: (stagedPath: string) => Promise<void>
): Promise<void> {
  const staged = posix.join(posix.dirname(path), `.sim-write-${generateShortId(16)}`)
  const started = Date.now()
  try {
    options.signal.throwIfAborted()
    await materialize(staged)
    options.signal.throwIfAborted()
    const remainingMs = options.timeoutMs - (Date.now() - started)
    if (remainingMs <= 0) throw new DOMException('timeout', 'AbortError')
    const published = await sandbox.runCommand(PUBLISH_FILE_COMMAND, {
      envs: {
        SIM_FILE_STAGE: staged,
        SIM_FILE_TARGET: path,
        SIM_FILE_OVERWRITE: options.overwrite ? '1' : '0',
        ...(options.executable ? { SIM_FILE_EXECUTABLE: '1' } : {}),
        ...(options.followSymlinks === false ? { SIM_FILE_FOLLOW_SYMLINKS: '0' } : {}),
      },
      timeoutMs: Math.min(30_000, remainingMs),
      maxOutputBytes: 64 * 1024,
      signal: options.signal,
      rootUser: options.rootUser,
      atMostOnce: true,
    })
    options.signal.throwIfAborted()
    if (published.timedOut) throw new DOMException('timeout', 'AbortError')
    if (published.exitCode !== 0) {
      throw new Error(
        published.stderr.trim() || published.stdout.trim() || 'Workbench file publication failed'
      )
    }
  } catch (error) {
    /** An upload or publication can land before its acknowledgement is lost. Only the staging path is ours. */
    await sandbox.removeFile(staged).catch(() => {})
    throw error
  }
}
