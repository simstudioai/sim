import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

/** Display metadata shared by workspace, Project, and public viewers. */
export interface ViewerFileRecord extends Omit<WorkspaceFileRecord, 'workspaceId' | 'uploadedBy'> {
  workspaceId?: string
  uploadedBy: string | null
}
