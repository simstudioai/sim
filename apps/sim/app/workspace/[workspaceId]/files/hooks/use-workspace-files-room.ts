'use client'

import { useFileListRoom } from '@/hooks/use-file-list-room'

/** Workspace callers share the owner-aware list controller without changing their room identity. */
export function useWorkspaceFilesRoom(workspaceId: string): void {
  useFileListRoom({
    owner: workspaceId ? { entityType: 'workspace', entityId: workspaceId } : null,
  })
}
