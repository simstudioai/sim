import type { BlockState, Position } from '@/stores/workflows/workflow/types'

export interface LayoutOptions {
  horizontalSpacing?: number
  verticalSpacing?: number
  padding?: { x: number; y: number }
  alignment?: 'start' | 'center' | 'end'
}

export interface LayoutResult {
  blocks: Record<string, BlockState>
  success: boolean
  error?: string
}

export interface Edge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface Loop {
  id: string
  nodes: string[]
  iterations: number
  loopType: 'for' | 'forEach'
}

export interface Parallel {
  id: string
  nodes: string[]
  count?: number
  parallelType?: 'count' | 'collection'
}

export interface BlockDimensions {
  width: number
  height: number
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
  dimensions: BlockDimensions
  incoming: Set<string>
  outgoing: Set<string>
  layer: number
  position: Position
}

export interface AdjustmentOptions extends LayoutOptions {
  preservePositions?: boolean
  minimalShift?: boolean
}
