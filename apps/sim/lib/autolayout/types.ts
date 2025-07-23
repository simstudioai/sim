export interface LayoutNode {
  id: string
  type: string
  name: string
  // Physical dimensions
  width: number
  height: number
  // Current position (if any)
  position?: { x: number; y: number }
  // Metadata for layout decisions
  category: 'trigger' | 'processing' | 'logic' | 'output' | 'container'
  isContainer: boolean
  parentId?: string
  // Handle configuration
  horizontalHandles?: boolean
  isWide?: boolean
}

export interface LayoutEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type?: string
}

export interface LayoutOptions {
  strategy: 'hierarchical' | 'force-directed' | 'layered' | 'smart'
  direction: 'horizontal' | 'vertical' | 'auto'
  spacing: {
    horizontal: number
    vertical: number
    layer: number
  }
  alignment: 'start' | 'center' | 'end'
  padding: {
    x: number
    y: number
  }
  constraints?: {
    maxWidth?: number
    maxHeight?: number
    preserveUserPositions?: boolean
  }
}

export interface LayoutResult {
  nodes: Array<{
    id: string
    position: { x: number; y: number }
  }>
  metadata: {
    strategy: string
    totalWidth: number
    totalHeight: number
    layerCount: number
    stats: {
      crossings: number
      totalEdgeLength: number
      nodeOverlaps: number
    }
  }
}

export interface WorkflowGraph {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
}

// Block category mapping for better layout decisions
export const BLOCK_CATEGORIES: Record<string, LayoutNode['category']> = {
  // Triggers
  starter: 'trigger',
  schedule: 'trigger',
  webhook: 'trigger',

  // Processing
  agent: 'processing',
  api: 'processing',
  function: 'processing',

  // Logic
  condition: 'logic',
  router: 'logic',
  evaluator: 'logic',

  // Output
  response: 'output',

  // Containers
  loop: 'container',
  parallel: 'container',
}

// Default dimensions for different block types
export const BLOCK_DIMENSIONS: Record<string, { width: number; height: number }> = {
  default: { width: 320, height: 120 },
  wide: { width: 480, height: 120 },
  container: { width: 500, height: 300 },
}
