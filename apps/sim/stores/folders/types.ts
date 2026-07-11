import type { FolderResourceType } from '@/lib/api/contracts/folders'

export interface Folder {
  id: string
  resourceType: FolderResourceType
  name: string
  userId: string
  workspaceId: string
  parentId: string | null
  locked: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date | null
}

export interface FolderTreeNode extends Folder {
  children: FolderTreeNode[]
  level: number
}
