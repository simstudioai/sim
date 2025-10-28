/**
 * Copilot File Management
 *
 * Provides file upload/download capabilities for Copilot interactions.
 * Uses persistent copilot storage (images only).
 */

export {
  type CopilotFileAttachment,
  deleteCopilotFile,
  downloadCopilotFile,
  type GenerateCopilotUploadUrlOptions,
  generateCopilotDownloadUrl,
  generateCopilotUploadUrl,
  isImageFileType,
  isSupportedFileType,
  processCopilotAttachments,
} from './copilot-file-manager'
