export interface MarketplaceData {
  id: string // Marketplace entry ID to track original marketplace source
  status: 'owner' | 'temp'
}

export interface WorkflowMetadata {
  id: string
  name: string
  lastModified: Date
  description?: string
  color: string
  marketplaceData?: MarketplaceData | null
  workspaceId?: string
}

export interface WorkflowRegistryState {
  workflows: Record<string, WorkflowMetadata>
  activeWorkflowId: string | null
  activeWorkspaceId: string | null
  isLoading: boolean
  error: string | null
}

export interface WorkflowRegistryActions {
  setLoading: (loading: boolean) => void
  setActiveWorkflow: (id: string) => Promise<void>
  setActiveWorkspace: (id: string) => void
  handleWorkspaceDeletion: (newWorkspaceId: string) => void
  removeWorkflow: (id: string) => void
  updateWorkflow: (id: string, metadata: Partial<WorkflowMetadata>) => void
  createWorkflow: (options?: {
    isInitial?: boolean
    marketplaceId?: string
    marketplaceState?: any
    name?: string
    description?: string
    workspaceId?: string
  }) => string
  duplicateWorkflow: (sourceId: string) => string | null
}

export type WorkflowRegistry = WorkflowRegistryState & WorkflowRegistryActions
