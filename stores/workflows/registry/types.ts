export interface WorkflowMetadata {
  id: string
  name: string
  color: string
}

export interface WorkflowRegistryState {
  workflows: Record<string, WorkflowMetadata>
  activeWorkflowId: string | null
}

export interface WorkflowRegistryActions {
  // Core actions
  setActiveWorkflow: (id: string) => void
  removeWorkflow: (id: string) => void
  updateWorkflow: (id: string, metadata: Partial<WorkflowMetadata>) => void
  createWorkflow: (options?: { isInitial?: boolean }) => string
}

export type WorkflowRegistry = WorkflowRegistryState & WorkflowRegistryActions
