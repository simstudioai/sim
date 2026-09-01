import type { BlockState, Position } from '@/stores/workflows/workflow/types'

export type { Edge } from '@xyflow/react'

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
  /**
   * Height reserved for spacing and overlap resolution. Deliberately biased
   * tall for a block that has never mounted, so two cards never collide.
   */
  height: number
  /**
   * Height the card actually paints, and the only height valid for locating a
   * port on it.
   *
   * Ports used to sit a fixed distance below a card's top, so height dropped
   * out of the handle math entirely — `y = sourceHandleY - 20` landed the port
   * on `sourceHandleY` however wrong the height was. Now that they are
   * vertically centred the height is *inside* that subtraction, and every
   * pixel `height` is inflated for safety tilts the edge by half of it.
   * Keeping the two apart lets spacing stay pessimistic while edges stay flat.
   */
  portHeight: number
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

interface LayerInfo {
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

interface AdjustmentOptions extends LayoutOptions {
  preservePositions?: boolean
  minimalShift?: boolean
}
