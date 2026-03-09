import type { BlockConfig } from '@/blocks/types'

/**
 * Props for the WorkflowBlock component
 */
export interface WorkflowBlockProps {
  type: string
  config: BlockConfig
  name: string
  isActive?: boolean
  isPending?: boolean
  isPreview?: boolean
  /** Whether this block is selected in preview mode */
  isPreviewSelected?: boolean
  subBlockValues?: Record<string, any>
  blockState?: any
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
