export interface Workflow {
  id: string
  folderId?: string | null
  name?: string
  description?: string
  userId?: string
  workspaceId?: string
  [key: string]: any // For additional properties
}

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
}

export interface FolderTreeNode extends WorkflowFolder {
  children: FolderTreeNode[]
  level: number
}
