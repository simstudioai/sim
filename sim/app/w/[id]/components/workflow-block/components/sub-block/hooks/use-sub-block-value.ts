import { useCallback, useEffect, useRef } from 'react'
import { isEqual } from 'lodash'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useToolParamsStore } from '@/stores/tool-params/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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
  // Get block type for param lookup
  const blockType = useWorkflowStore(useCallback((state) => state.blocks[blockId]?.type, [blockId]))

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
    useCallback((state) => state.getValue(blockId, subBlockId), [blockId, subBlockId])
  )

  // Check if this is an API key field that could be auto-filled
  const isApiKey = subBlockId === 'apiKey' || subBlockId.toLowerCase().includes('apikey')

  // Check if auto-fill environment variables is enabled
  const isAutoFillEnvVarsEnabled = useGeneralStore((state) => state.isAutoFillEnvVarsEnabled)

  // When component mounts, check for existing API key in toolParamsStore
  useEffect(() => {
    // Skip autofill if the feature is disabled in settings
    if (!isAutoFillEnvVarsEnabled) {
      return
    }

    // Skip autofill for agent blocks
    if (blockType === 'agent') {
      return
    }

    // Only run for API key fields that don't already have a value
    if (isApiKey && blockType && (!storeValue || storeValue === '')) {
      const toolParamsStore = useToolParamsStore.getState()
      // Pass the blockId as instanceId to check if this specific instance has been cleared
      const savedValue = toolParamsStore.resolveParamValue(blockType, 'apiKey', blockId)

      if (savedValue && savedValue !== '' && savedValue !== storeValue) {
        // Auto-fill the API key from the param store
        useSubBlockStore.getState().setValue(blockId, subBlockId, savedValue)
      }
    } else if (isApiKey && blockType && storeValue && typeof storeValue === 'string') {
      // Check if the existing value is an environment variable reference that no longer resolves
      if (storeValue.startsWith('{{') && storeValue.endsWith('}}')) {
        const toolParamsStore = useToolParamsStore.getState()

        // Pass the blockId as instanceId
        const currentValue = toolParamsStore.resolveParamValue(blockType, 'apiKey', blockId)

        if (currentValue !== storeValue) {
          // If we got a replacement or null, update the field
          if (currentValue) {
            // Replacement found - update to new reference
            useSubBlockStore.getState().setValue(blockId, subBlockId, currentValue)
          } else if (storeValue.startsWith('{{') && storeValue.endsWith('}}')) {
            // No replacement and current value is an env var that doesn't exist
            // For fields already on the screen, we'll keep the reference but it won't resolve
            // This provides visual feedback to the user that something is wrong
          }
        }
      }
    }
  }, [blockId, subBlockId, blockType, storeValue, isApiKey, isAutoFillEnvVarsEnabled])

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
        const valueCopy =
          newValue === null
            ? null
            : typeof newValue === 'object'
              ? JSON.parse(JSON.stringify(newValue))
              : newValue

        // Check if this is an empty value for an API key field that previously had a value
        // This indicates the user has deliberately cleared the field
        if (
          isApiKey &&
          blockType &&
          storeValue &&
          storeValue !== '' &&
          (newValue === null || newValue === '' || String(newValue).trim() === '')
        ) {
          // Mark this specific instance as cleared so we don't auto-fill it
          const toolParamsStore = useToolParamsStore.getState()
          toolParamsStore.markParamAsCleared(blockId, 'apiKey')
        }
        // For API keys, also store in toolParamsStore for cross-block reuse
        // We still store agent block API keys so they can be used for other blocks,
        // but we won't autofill other agent blocks with them
        else if (isApiKey && blockType && newValue && String(newValue).trim() !== '') {
          const toolParamsStore = useToolParamsStore.getState()
          toolParamsStore.setParam(blockType, 'apiKey', String(newValue))
        }

        // Update the subblock store with the new value
        // The store's setValue method will now trigger the debounced sync automatically
        useSubBlockStore.getState().setValue(blockId, subBlockId, valueCopy)

        if (triggerWorkflowUpdate) {
          useWorkflowStore.getState().triggerUpdate()
        }
      }
    },
    [blockId, subBlockId, blockType, isApiKey, storeValue, triggerWorkflowUpdate]
  )

  // Return the current value and setter
  return [valueRef.current as T | null, setValue] as const
}
