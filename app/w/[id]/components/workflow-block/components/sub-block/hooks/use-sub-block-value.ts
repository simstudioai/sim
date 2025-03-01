import { useCallback } from 'react'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

export function useSubBlockValue<T = any>(
  blockId: string,
  subBlockId: string,
  triggerWorkflowUpdate: boolean = false
): readonly [T | null, (value: T) => void] {
  // Get initial value from workflow store
  const initialValue = useWorkflowStore(
    useCallback(
      (state) => state.blocks[blockId]?.subBlocks[subBlockId]?.value ?? null,
      [blockId, subBlockId]
    )
  )

  // Get value and setter from subblock store
  const value = useSubBlockStore(
    useCallback(
      (state) => state.getValue(blockId, subBlockId) ?? initialValue,
      [blockId, subBlockId, initialValue]
    )
  )

  const setValue = useCallback(
    (newValue: T) => {
      useSubBlockStore.getState().setValue(blockId, subBlockId, newValue)
      if (triggerWorkflowUpdate) {
        useWorkflowStore.getState().triggerUpdate()
      }
    },
    [blockId, subBlockId, triggerWorkflowUpdate]
  )

  return [value as T | null, setValue] as const
}
