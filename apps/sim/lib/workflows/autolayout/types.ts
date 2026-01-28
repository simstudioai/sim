import type { BlockState, Position } from '@/stores/workflows/workflow/types'

export type { Edge } from 'reactflow'
export type { Loop, Parallel } from '@/stores/workflows/workflow/types'

export interface LayoutOptions {
  horizontalSpacing?: number
  verticalSpacing?: number
  padding?: { x: number; y: number }
  gridSize?: number
}

export interface LayoutResult {
  blocks: Record<string, BlockState>
  success: boolean
  error?: string
}

export interface BlockMetrics {
  width: number
  height: number
  minWidth: number
  minHeight: number
  paddingTop: number
  paddingBottom: number
  paddingLeft: number
  paddingRight: number
}

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface LayerInfo {
  layer: number
  order: number
}

export interface GraphNode {
  id: string
  block: BlockState
  metrics: BlockMetrics
  incoming: Set<string>
  outgoing: Set<string>
  layer: number
  position: Position
}

export interface AdjustmentOptions extends LayoutOptions {
  preservePositions?: boolean
  minimalShift?: boolean
}
