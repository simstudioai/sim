export { resolveFileCategory } from '@/components/file-viewer/file-category'
export {
  filesBrowserListParams,
  filesFilterParsers,
  filesFilterUrlKeys,
  filesListPreferenceConfig,
  filesParsers,
  filesSortParams,
  filesUrlKeys,
} from '@/components/file-viewer/search-params'
export { assessTextEditorPaste } from '@/components/file-viewer/text-editor-paste'
export { DEFAULT_UNTITLED_NAME } from '@/components/file-viewer/untitled-title'
export { useDocPreviewBinary } from '@/components/file-viewer/use-doc-preview-binary'
export { useEditableFileContent } from '@/components/file-viewer/use-editable-file-content'
export { useSelectionCopyBridge } from '@/components/file-viewer/use-selection-copy-bridge'
export type { ShareAuthType, ShareRecord } from '@/lib/api/contracts/public-shares'
export { CSV_PREVIEW_MAX_ROWS } from '@/lib/api/contracts/workspace-file-table'
export { useDeploymentShape } from '@/lib/core/config/deployment-shape'
export { readSeparatorKey } from '@/lib/core/utils/separator-keys'
export { validateAllowlistEntry } from '@/lib/messaging/email/validation'
export {
  buildFileSelectionLabel,
  truncateSelectionText,
} from '@/lib/mothership/chat/selection-context'
export { simLinkUrl } from '@/lib/navigation/paths'
export { suggestSimLinkName } from '@/lib/sim-links/validation'
export {
  type FileDownloadSource,
  triggerArchiveDownload,
  triggerFileDownload,
} from '@/lib/uploads/client/download'
export {
  MAX_TEXT_PREVIEW_BYTES,
  TEXT_PREVIEW_SIZE_MESSAGE,
} from '@/lib/uploads/client/text-content'
export { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
export {
  getFileExtension,
  getMimeTypeFromExtension,
  isArchiveFileName,
  resolveMediaMimeType,
} from '@/lib/uploads/utils/file'
export { formatFileSize } from '@/lib/uploads/utils/file-size'
export { normalizeMimeType } from '@/lib/uploads/utils/mime'
export { fileBrowserTypeLabel } from '@/lib/workspace-files/browser'
export { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-content-type'
export { usePinnedWorkspaceFiles } from '@/hooks/queries/pinned-workspace-files'
export { useFileShare, useUpsertFileShare } from '@/hooks/queries/public-shares'
export { useSimLinksForUrl } from '@/hooks/queries/sim-links'
export {
  useCreateWorkspaceFile,
  useDeleteWorkspaceFile,
  useRenameWorkspaceFile,
  useReresolveFileRecord,
  useUploadWorkspaceFile,
  useWorkspaceFileBinary,
  useWorkspaceFileFolderSizes,
  useWorkspaceFileList,
  useWorkspaceFileRecord,
  useWorkspaceImageDimensionsAdapter,
  workspaceFileRecordState,
} from '@/hooks/queries/workspace-files'
export type { SaveStatus } from '@/hooks/use-autosave'
export {
  createWorkspaceFileContentSource,
  FileContentSourceProvider,
  useFileContentSource,
} from '@/hooks/use-file-content-source'
export { useWorkspaceFilesRoom } from '@/hooks/use-workspace-files-room'
export type { ChatContext } from '@/stores/panel'
export { useFileAccess } from './access'
export { useAddToChat } from './add-to-chat'
export { useDeriveFileTitle } from './title'
export type { WorkspaceFileRecord } from './types'
