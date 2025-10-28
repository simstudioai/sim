/**
 * Chat File Management
 *
 * Provides file upload/download capabilities for chat interactions.
 * Uses temporary execution storage (5-10 min expiry) for privacy and cost control.
 */

export {
  type ChatExecutionContext,
  type ChatFile,
  processChatFiles,
  type UserFile,
  uploadChatFile,
} from './chat-file-manager'
