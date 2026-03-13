export type {
  DirEntry,
  GrepCountEntry,
  GrepMatch,
  GrepOptions,
  GrepOutputMode,
  ReadResult,
} from '@/lib/copilot/vfs/operations'
export type { FileReadResult } from '@/lib/copilot/vfs/file-reader'
export { readFileRecord } from '@/lib/copilot/vfs/file-reader'
export {
  getOrMaterializeVFS,
  sanitizeName,
  WorkspaceVFS,
} from '@/lib/copilot/vfs/workspace-vfs'
