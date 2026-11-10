/**
 * Position interface for floating chat
 */
export interface ChatPosition {
  x: number
  y: number
}

/**
 * Output configuration for chat deployments
 */
export interface OutputConfig {
  workflowId?: string
  blockId: string
  path: string
}
