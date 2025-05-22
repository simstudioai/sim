import { Edge } from 'reactflow'
import { BlockOutput, SubBlockType } from '@/blocks/types'

export interface Position {
  x: number
  y: number
}

export interface BlockState {
  id: string
  type: string
  name: string
  position: Position
  subBlocks: Record<string, SubBlockState>
  outputs: Record<string, BlockOutput>
  enabled: boolean
  horizontalHandles?: boolean
  isWide?: boolean
  height?: number
  advancedMode?: boolean
}

export interface SubBlockState {
  id: string
  type: SubBlockType
  value: string | number | string[][] | null
}

export interface Loop {
  id: string
  nodes: string[]
  iterations: number
  loopType: 'for' | 'forEach'
  forEachItems?: any[] | Record<string, any> | string // Items or expression
}

export interface DeploymentStatus {
  isDeployed: boolean
  deployedAt?: Date
  apiKey?: string
  needsRedeployment?: boolean
}

export interface WorkflowState {
  blocks: Record<string, BlockState>
  edges: Edge[]
  lastSaved?: number
  loops: Record<string, Loop>
  lastUpdate?: number
  // Legacy deployment fields (keeping for compatibility)
  isDeployed?: boolean
  deployedAt?: Date
  // New field for per-workflow deployment status
  deploymentStatuses?: Record<string, DeploymentStatus>
  needsRedeployment?: boolean
  hasActiveSchedule?: boolean
  hasActiveWebhook?: boolean
}

// New interface for sync control
export interface SyncControl {
  // Mark the workflow as changed, requiring sync
  markDirty: () => void
  // Check if the workflow has unsaved changes
  isDirty: () => boolean
  // Immediately trigger a sync
  forceSync: () => void
}

export interface WorkflowActions {
  addBlock: (id: string, type: string, name: string, position: Position) => void
  updateBlockPosition: (id: string, position: Position) => void
  removeBlock: (id: string) => void
  addEdge: (edge: Edge) => void
  removeEdge: (edgeId: string) => void
  clear: () => Partial<WorkflowState>
  updateLastSaved: () => void
  toggleBlockEnabled: (id: string) => void
  duplicateBlock: (id: string) => void
  toggleBlockHandles: (id: string) => void
  updateBlockName: (id: string, name: string) => void
  toggleBlockWide: (id: string) => void
  updateBlockHeight: (id: string, height: number) => void
  triggerUpdate: () => void
  updateLoopIterations: (loopId: string, iterations: number) => void
  updateLoopType: (loopId: string, loopType: Loop['loopType']) => void
  updateLoopForEachItems: (loopId: string, items: string) => void
  setNeedsRedeploymentFlag: (needsRedeployment: boolean) => void
  setScheduleStatus: (hasActiveSchedule: boolean) => void
  setWebhookStatus: (hasActiveWebhook: boolean) => void
  toggleBlockAdvancedMode: (id: string) => void

  // Add the sync control methods to the WorkflowActions interface
  sync: SyncControl
}

export type WorkflowStore = WorkflowState & WorkflowActions
