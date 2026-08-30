/**
 * Granted local folders are addressed through the ordinary VFS: the model uses
 * `read`/`grep`/`glob` against paths under `user-local/`, exactly as it does
 * for workspace files. There is no separate local toolset, and local files are
 * read-only.
 */
export const USER_LOCAL_VFS_ROOT = 'user-local'

export function hasUserLocalVfsPrefix(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return value === USER_LOCAL_VFS_ROOT || value.startsWith(`${USER_LOCAL_VFS_ROOT}/`)
}

export function isUserLocalVfsToolCall(
  name: string,
  args: Record<string, unknown> | undefined
): boolean {
  if (!args) return false
  if (name === 'read') return hasUserLocalVfsPrefix(args.path)
  if (name === 'grep') return hasUserLocalVfsPrefix(args.path)
  if (name === 'glob') return hasUserLocalVfsPrefix(args.pattern)
  return false
}
