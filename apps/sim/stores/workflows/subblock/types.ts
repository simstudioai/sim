import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Value type for subblock values.
 * Uses unknown to support various value types that subblocks can store,
 * including strings, numbers, arrays, objects, and other complex structures.
 */
export type SubBlockValue = unknown

export interface SubBlockStoreState {
  workflowValues: Record<string, Record<string, Record<string, SubBlockValue>>> // Store values per workflow ID
  loadingWebhooks: Set<string> // Track which blockIds are currently loading webhooks
  checkedWebhooks: Set<string> // Track which blockIds have been checked for webhooks
}

export interface SubBlockStore extends SubBlockStoreState {
  setValue: (blockId: string, subBlockId: string, value: SubBlockValue) => void
  getValue: (blockId: string, subBlockId: string) => SubBlockValue | undefined
  clear: () => void
  initializeFromWorkflow: (workflowId: string, blocks: Record<string, BlockState>) => void
  setWorkflowValues: (
    workflowId: string,
    values: Record<string, Record<string, SubBlockValue>>
  ) => void
}
