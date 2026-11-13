import { lstat, readlink, realpath } from 'node:fs/promises'
import { win32 } from 'node:path'

/** Refuses a path that resolves to, or passes through a link to, a network location. */
export class NetworkLocationError extends Error {
  constructor() {
    super('Network locations are not supported. Choose a file or folder on this computer.')
    this.name = 'NetworkLocationError'
  }
}

/** Windows follows at most this many links while resolving a path, as POSIX caps `ELOOP`. */
const MAX_LINK_HOPS = 40

/** The filesystem calls {@link localRealpath} makes. Tests inject them to model Windows links. */
interface LocalRealpathFileSystem {
  lstat: (path: string) => Promise<{ isSymbolicLink(): boolean }>
  readlink: (path: string) => Promise<string>
  realpath: (path: string) => Promise<string>
}

/** Looks each call up on `node:fs/promises` when it runs, as every other caller in the shell does. */
const NODE_FILE_SYSTEM: LocalRealpathFileSystem = {
  lstat: (path) => lstat(path),
  readlink: (path) => readlink(path),
  realpath: (path) => realpath(path),
}

/**
 * A UNC share (`\\host\share`), a `\\?\` or `\\.\` device path, or an NT `\??\` path: any of them
 * can name a remote host. Forward slashes count, since Windows accepts them as separators.
 */
function isWin32NetworkPath(path: string): boolean {
  return /^[\\/]{2}/.test(path) || path.startsWith('\\??\\')
}

/**
 * Walks `path` one component at a time with `lstat`, which never follows a link, and refuses any
 * symlink or junction whose target is a network path. Each local link target is walked in turn,
 * so a chain of local links ending at a share is refused too. A missing component throws the same
 * error `realpath` would.
 */
async function assertNoNetworkLink(path: string, fs: LocalRealpathFileSystem): Promise<void> {
  const absolute = win32.resolve(path)
  let current = win32.parse(absolute).root
  const pending = absolute.slice(current.length).split(/[\\/]/)
  let hops = 0
  while (pending.length > 0) {
    const segment = pending.shift()
    if (!segment || segment === '.') continue
    if (segment === '..') {
      current = win32.dirname(current)
      continue
    }
    const next = win32.join(current, segment)
    if (!(await fs.lstat(next)).isSymbolicLink()) {
      current = next
      continue
    }
    if (++hops > MAX_LINK_HOPS) throw new Error('The path has too many levels of links.')
    const target = await fs.readlink(next)
    const resolvedTarget = win32.resolve(current, target)
    if (isWin32NetworkPath(resolvedTarget)) throw new NetworkLocationError()
    current = win32.parse(resolvedTarget).root
    pending.unshift(...resolvedTarget.slice(current.length).split(/[\\/]/))
  }
}

/**
 * `realpath` for any path a model or a folder picker supplies, which must stay on this computer.
 *
 * On Windows, `realpath` follows every symlink in the path, and following one that targets
 * `\\host\share` makes Windows authenticate to that host with the user's NTLM hash, so a link
 * planted in a repository would leak it before any consent dialog. The components are walked with
 * `lstat` first and a link to a network path is refused without being followed. A resolved path
 * that is itself a share (a drive letter mapped to one resolves to `\\server\share`) is refused as
 * well: the native file backend cannot open it, so granting it would be a dead end.
 *
 * A process already running as the user could still swap a checked component for a network link
 * between the walk and `realpath`; the walk closes the path a planted link takes, not that race.
 * Elsewhere it is plain `realpath`.
 */
export async function localRealpath(
  path: string,
  platform: NodeJS.Platform = process.platform,
  fs: LocalRealpathFileSystem = NODE_FILE_SYSTEM
): Promise<string> {
  if (platform !== 'win32') return fs.realpath(path)
  if (isWin32NetworkPath(path)) throw new NetworkLocationError()
  await assertNoNetworkLink(path, fs)
  const real = await fs.realpath(path)
  if (isWin32NetworkPath(real)) throw new NetworkLocationError()
  return real
}
