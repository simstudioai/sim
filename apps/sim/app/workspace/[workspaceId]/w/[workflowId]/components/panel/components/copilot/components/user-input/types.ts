import type { MentionFolderId } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/constants'

/**
 * Shared folder navigation state for the mention menu.
 */
export interface MentionFolderNav {
  currentFolder: MentionFolderId | null
  isInFolder: boolean
  openFolder: (folderId: MentionFolderId, title: string) => void
  closeFolder: () => void
}
