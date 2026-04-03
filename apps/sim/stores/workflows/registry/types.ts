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
  archivedAt?: Date | null
  /** True for sandbox exercises (Sim Academy). Skips real API calls. */
  isSandbox?: boolean
}

export type HydrationPhase = 'idle' | 'creating' | 'state-loading' | 'ready' | 'error'

export interface HydrationState {
  phase: HydrationPhase
  workspaceId: string | null
  workflowId: string | null
  requestId: string | null
  error: string | null
}

export interface WorkflowRegistryState {
  activeWorkflowId: string | null
  error: string | null
  deploymentStatuses: Record<string, DeploymentStatus>
  hydration: HydrationState
  clipboard: ClipboardData | null
  pendingSelection: string[] | null
}

export interface WorkflowRegistryActions {
  setActiveWorkflow: (id: string) => Promise<void>
  loadWorkflowState: (workflowId: string) => Promise<void>
  switchToWorkspace: (id: string) => void
  markWorkflowCreating: (workflowId: string) => void
  markWorkflowCreated: (workflowId: string | null) => void
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
