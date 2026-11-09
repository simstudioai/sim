import type { BlockConfig } from '@/blocks/types'

/**
 * Props for the WorkflowBlock component
 */
export interface WorkflowBlockProps extends Record<string, unknown> {
  type: string
  config: BlockConfig
  name: string
  isActive?: boolean
  isPending?: boolean
  isPreview?: boolean
  /** Whether this block is selected in preview mode */
  isPreviewSelected?: boolean
  /** Whether this block is rendered inside an embedded (read-only) workflow view */
  isEmbedded?: boolean
  /** Whether the parent workflow is locked and should render as read-only */
  isWorkflowLocked?: boolean
  subBlockValues?: Record<string, any>
  blockState?: any
  /** Persists and broadcasts the Error output toggle. */
  onSetErrorOutputEnabled?: (blockId: string, enabled: boolean) => void
  /** Persists and broadcasts edge removals caused by disabling Error output. */
  onRemoveEdges?: (edgeIds: string[]) => void
}

/**
 * Schedule information for scheduled workflows
 */
export interface ScheduleInfo {
  scheduleTiming: string
  nextRunAt: string | null
  lastRanAt: string | null
  timezone: string
  status?: string
  isDisabled?: boolean
  failedCount?: number
  id?: string
}
