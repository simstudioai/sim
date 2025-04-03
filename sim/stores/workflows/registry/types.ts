export interface MarketplaceData {
  id: string
  status: 'owner' | 'temp' | 'star'
}

export interface WorkflowMetadata {
  id: string
  name: string
  lastModified: Date
  description?: string
  color: string
  marketplaceData?: MarketplaceData | null
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
