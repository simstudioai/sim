export type {
  DirEntry,
  GrepCountEntry,
  GrepMatch,
  GrepOptions,
  GrepOutputMode,
  ReadResult,
} from '@/lib/copilot/vfs/operations'
export type { FileReadResult } from '@/lib/copilot/vfs/workspace-vfs'
export {
  getOrMaterializeVFS,
  sanitizeName,
  WorkspaceVFS,
} from '@/lib/copilot/vfs/workspace-vfs'
