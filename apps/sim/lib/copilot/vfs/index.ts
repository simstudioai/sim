export { WorkspaceVFS, getOrMaterializeVFS } from '@/lib/copilot/vfs/workspace-vfs'
export type {
  GrepMatch,
  GrepOptions,
  GrepOutputMode,
  GrepCountEntry,
  ReadResult,
  DirEntry,
} from '@/lib/copilot/vfs/operations'
export {
  serializeBlockSchema,
  serializeDocuments,
  serializeIntegrationSchema,
  serializeKBMeta,
  serializeRecentExecutions,
  serializeWorkflowMeta,
} from '@/lib/copilot/vfs/serializers'
