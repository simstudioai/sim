/**
 * Legacy client-tool names remain recognizable so an already-persisted
 * checkpoint from an older desktop build can finish safely. New requests never
 * advertise these schemas: local files live under the ordinary `user-local/`
 * VFS namespace and use read/grep/glob.
 */
export const LOCAL_FILESYSTEM_TOOL_NAMES = {
  mountDirectory: 'local_mount_directory',
  listMounts: 'local_list_mounts',
  forgetMount: 'local_forget_mount',
  list: 'local_list',
  glob: 'local_glob',
  read: 'local_read',
  grep: 'local_grep',
  stat: 'local_stat',
  stageFile: 'local_stage_file',
} as const

const LEGACY_LOCAL_FILESYSTEM_TOOL_NAME_SET = new Set<string>(
  Object.values(LOCAL_FILESYSTEM_TOOL_NAMES)
)

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

export function isLocalFilesystemToolName(name: string): boolean {
  return LEGACY_LOCAL_FILESYSTEM_TOOL_NAME_SET.has(name)
}

export function isDesktopFilesystemToolCall(
  name: string,
  args: Record<string, unknown> | undefined
): boolean {
  return isLocalFilesystemToolName(name) || isUserLocalVfsToolCall(name, args)
}
