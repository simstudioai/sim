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
  id?: string
}
