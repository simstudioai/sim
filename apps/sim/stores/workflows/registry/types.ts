import type { Edge } from 'reactflow'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

export interface DeploymentStatus {
  isDeployed: boolean
  deployedAt?: Date
  apiKey?: string
  needsRedeployment?: boolean
}

export interface ClipboardData {
  blocks: Record<string, BlockState>
  edges: Edge[]
  subBlockValues: Record<string, Record<string, unknown>>
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  timestamp: number
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
  sortOrder: number
}

export type HydrationPhase =
  | 'idle'
  | 'metadata-loading'
  | 'metadata-ready'
  | 'state-loading'
  | 'ready'
  | 'error'

export interface HydrationState {
  phase: HydrationPhase
  workspaceId: string | null
  workflowId: string | null
  requestId: string | null
  error: string | null
}

export interface WorkflowRegistryState {
  workflows: Record<string, WorkflowMetadata>
  activeWorkflowId: string | null
  error: string | null
  deploymentStatuses: Record<string, DeploymentStatus>
  hydration: HydrationState
  clipboard: ClipboardData | null
  pendingSelection: string[] | null
}

export interface WorkflowRegistryActions {
  beginMetadataLoad: (workspaceId: string) => void
  completeMetadataLoad: (workspaceId: string, workflows: WorkflowMetadata[]) => void
  failMetadataLoad: (workspaceId: string | null, error: string) => void
  setActiveWorkflow: (id: string) => Promise<void>
  loadWorkflowState: (workflowId: string) => Promise<void>
  switchToWorkspace: (id: string) => Promise<void>
  removeWorkflow: (id: string) => Promise<void>
  updateWorkflow: (id: string, metadata: Partial<WorkflowMetadata>) => Promise<void>
  duplicateWorkflow: (sourceId: string) => Promise<string | null>
  getWorkflowDeploymentStatus: (workflowId: string | null) => DeploymentStatus | null
  setDeploymentStatus: (
    workflowId: string | null,
    isDeployed: boolean,
    deployedAt?: Date,
    apiKey?: string
  ) => void
  setWorkflowNeedsRedeployment: (workflowId: string | null, needsRedeployment: boolean) => void
  copyBlocks: (blockIds: string[]) => void
  preparePasteData: (positionOffset?: { x: number; y: number }) => {
    blocks: Record<string, BlockState>
    edges: Edge[]
    loops: Record<string, Loop>
    parallels: Record<string, Parallel>
    subBlockValues: Record<string, Record<string, unknown>>
  } | null
  hasClipboard: () => boolean
  clearClipboard: () => void
  setPendingSelection: (blockIds: string[]) => void
  clearPendingSelection: () => void
  logout: () => void
}

export type WorkflowRegistry = WorkflowRegistryState & WorkflowRegistryActions
