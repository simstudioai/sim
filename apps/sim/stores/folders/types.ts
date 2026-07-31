import type { FolderResourceType } from '@/lib/api/contracts/folders'

/**
 * Client-side shape of a folder row. Named for its original workflow-only scope; now
 * carries `resourceType` since the underlying table is shared by workflows, files,
 * knowledge bases, and tables.
 *
 * `color` and `isExpanded` were dropped along with the generic-folder table: `color` had
 * no consumer, and expansion state is client-only (it lives in this store, and was never
 * read back from the server).
 */
export interface WorkflowFolder {
  id: string
  resourceType: FolderResourceType
  name: string
  userId: string
  workspaceId: string
  parentId: string | null
  /** Only meaningful for `workflow` folders; locking is not extended to other types. */
  locked: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date | null
}

export interface FolderTreeNode extends WorkflowFolder {
  children: FolderTreeNode[]
  level: number
}
