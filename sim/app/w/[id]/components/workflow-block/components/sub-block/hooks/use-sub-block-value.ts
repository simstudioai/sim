import { useCallback, useEffect, useRef } from 'react'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { isEqual } from 'lodash'

/**
 * Custom hook to get and set values for a sub-block in a workflow.
 * Handles complex object values properly by using deep equality comparison.
 * 
 * @param blockId The ID of the block containing the sub-block
 * @param subBlockId The ID of the sub-block
 * @param triggerWorkflowUpdate Whether to trigger a workflow update when the value changes
 * @returns A tuple containing the current value and a setter function
 */
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

  // Keep a ref to the latest value to prevent unnecessary re-renders
  const valueRef = useRef<T | null>(null)

  // Get value from subblock store
  const storeValue = useSubBlockStore(
    useCallback(
      (state) => state.getValue(blockId, subBlockId),
      [blockId, subBlockId]
    )
  )

  // Update the ref if the store value changes
  // This ensures we're always working with the latest value
  useEffect(() => {
    // Use deep comparison for objects to prevent unnecessary updates
    if (!isEqual(valueRef.current, storeValue)) {
      valueRef.current = storeValue !== undefined ? storeValue : initialValue
    }
  }, [storeValue, initialValue])

  // Set value function that handles deep equality for complex objects
  const setValue = useCallback(
    (newValue: T) => {
      // Use deep comparison to avoid unnecessary updates for complex objects
      if (!isEqual(valueRef.current, newValue)) {
        valueRef.current = newValue
        
        // Ensure we're passing the actual value, not a reference that might change
        const valueCopy = newValue === null 
          ? null 
          : (typeof newValue === 'object' ? JSON.parse(JSON.stringify(newValue)) : newValue)
        
        useSubBlockStore.getState().setValue(blockId, subBlockId, valueCopy)
        
        if (triggerWorkflowUpdate) {
          useWorkflowStore.getState().triggerUpdate()
        }
      }
    },
    [blockId, subBlockId, triggerWorkflowUpdate]
  )

  // Return the current value and setter
  return [valueRef.current as T | null, setValue] as const
}
