import type { Edge, Node } from 'reactflow'

/**
 * Properties for a tag component
 */
export interface TagProps {
  /** Icon element to display in the tag */
  icon: React.ReactNode
  /** Text label for the tag */
  label: string
}

/**
 * Data structure for a landing card component
 */
export interface LandingCardData {
  /** Icon element to display in the card header */
  icon: React.ReactNode
  /** Background color for the icon container */
  color: string | '#f6f6f6'
  /** Name/title of the card */
  name: string
  /** Optional tags to display at the bottom of the card */
  tags?: TagProps[]
}

/**
 * Landing block node with positioning information
 */
export interface LandingBlockNode extends LandingCardData {
  /** Unique identifier for the node */
  id: string
  /** X coordinate position */
  x: number
  /** Y coordinate position */
  y: number
}

/**
 * Data structure for edges connecting nodes
 */
export interface LandingEdgeData {
  /** Unique identifier for the edge */
  id: string
  /** Source node ID */
  from: string
  /** Target node ID */
  to: string
}

/**
 * Data structure for grouping visual elements
 */
export interface LandingGroupData {
  /** X coordinate of the group */
  x: number
  /** Y coordinate of the group */
  y: number
  /** Width of the group */
  w: number
  /** Height of the group */
  h: number
  /** Labels associated with the group */
  labels: string[]
}

/**
 * Manual block with responsive positioning
 */
export interface LandingManualBlock extends Omit<LandingCardData, 'x' | 'y'> {
  /** Unique identifier */
  id: string
  /** Responsive position configurations */
  positions: {
    /** Position for mobile devices */
    mobile: { x: number; y: number }
    /** Position for tablet devices */
    tablet: { x: number; y: number }
    /** Position for desktop devices */
    desktop: { x: number; y: number }
  }
}

/**
 * Public API for controlling the viewport
 */
export interface LandingViewportApi {
  /**
   * Pan the viewport to specific coordinates
   * @param x - X coordinate to pan to
   * @param y - Y coordinate to pan to
   * @param options - Optional configuration for the pan animation
   */
  panTo: (x: number, y: number, options?: { duration?: number }) => void
  /**
   * Get the current viewport state
   * @returns Current viewport position and zoom level
   */
  getViewport: () => { x: number; y: number; zoom: number }
}

/**
 * Props for the LandingCanvas component
 */
export interface LandingCanvasProps {
  /** Array of nodes to render */
  nodes: Node[]
  /** Array of edges connecting nodes */
  edges: Edge[]
  /** Optional group box for visual grouping */
  groupBox: LandingGroupData | null
  /** Total width of the world/canvas */
  worldWidth: number
  /** Ref to expose viewport control API */
  viewportApiRef: React.MutableRefObject<LandingViewportApi | null>
}

/**
 * Props for the LandingFlow component
 */
export interface LandingFlowProps extends LandingCanvasProps {
  /** Reference to the wrapper element */
  wrapperRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Props for the LandingBlock component
 */
export interface LandingBlockProps extends LandingCardData {
  /** Optional CSS class names */
  className?: string
}
