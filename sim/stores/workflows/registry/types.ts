export interface WorkflowMetadata {
  id: string
  name: string
  lastModified: Date
  description?: string
  color: string
  marketplaceStatus?: 'temp' | 'star' | null
  marketplaceId?: string
}

export interface WorkflowRegistryState {
  workflows: Record<string, WorkflowMetadata>
  activeWorkflowId: string | null
  isLoading: boolean
  error: string | null
}

export interface WorkflowRegistryActions {
  setActiveWorkflow: (id: string) => Promise<void>
  removeWorkflow: (id: string) => void
  updateWorkflow: (id: string, metadata: Partial<WorkflowMetadata>) => void
  createWorkflow: (options?: { 
    isInitial?: boolean, 
    marketplaceId?: string, 
    marketplaceState?: any,
    name?: string,
    description?: string
  }) => string
}

export type WorkflowRegistry = WorkflowRegistryState & WorkflowRegistryActions
