export interface WorkflowFolder {
  id: string
  name: string
  userId: string
  workspaceId: string
  parentId: string | null
  color: string
  isExpanded: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  archivedAt?: Date | null
}

export interface FolderTreeNode extends WorkflowFolder {
  children: FolderTreeNode[]
  level: number
}
