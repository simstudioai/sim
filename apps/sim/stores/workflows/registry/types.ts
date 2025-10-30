export interface DeploymentStatus {
  isDeployed: boolean
  deployedAt?: Date
  apiKey?: string
  needsRedeployment?: boolean
}

export interface WorkflowMetadata {
  id: string
  name: string
  lastModified: Date
  createdAt: Date
  description?: string
  color: string
  workspaceId?: string
  folderId?: string | null
}

export interface WorkflowRegistryState {
  workflows: Record<string, WorkflowMetadata>
  activeWorkflowId: string | null
  isLoading: boolean
  error: string | null
  deploymentStatuses: Record<string, DeploymentStatus>
}

export interface WorkflowRegistryActions {
  setLoading: (loading: boolean) => void
  setActiveWorkflow: (id: string) => Promise<void>
  switchToWorkspace: (id: string) => Promise<void>
  loadWorkflows: (workspaceId?: string) => Promise<void>
  removeWorkflow: (id: string) => Promise<void>
  updateWorkflow: (id: string, metadata: Partial<WorkflowMetadata>) => Promise<void>
  createWorkflow: (options?: {
    isInitial?: boolean
    name?: string
    description?: string
    workspaceId?: string
    folderId?: string | null
  }) => Promise<string>
  duplicateWorkflow: (sourceId: string) => Promise<string | null>
  getWorkflowDeploymentStatus: (workflowId: string | null) => DeploymentStatus | null
  setDeploymentStatus: (
    workflowId: string | null,
    isDeployed: boolean,
    deployedAt?: Date,
    apiKey?: string
  ) => void
  setWorkflowNeedsRedeployment: (workflowId: string | null, needsRedeployment: boolean) => void
}

export type WorkflowRegistry = WorkflowRegistryState & WorkflowRegistryActions
