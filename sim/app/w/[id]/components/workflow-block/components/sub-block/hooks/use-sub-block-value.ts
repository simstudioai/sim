import { useCallback, useEffect, useRef } from 'react'
import { isEqual } from 'lodash'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useToolParamsStore } from '@/stores/tool-params/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { getProviderFromModel } from '@/providers/utils'

/**
 * Helper to handle API key auto-fill for agent blocks
 */
function handleAgentBlockApiKey(
  blockId: string,
  subBlockId: string,
  modelValue: string | null | undefined,
  storeValue: any
) {
  // Only proceed if we have a model selected
  if (!modelValue) return

  // Get the provider for this model
  const provider = getProviderFromModel(modelValue)

  // Skip if we couldn't determine a provider
  if (!provider || provider === 'ollama') return

  const toolParamsStore = useToolParamsStore.getState()
  const subBlockStore = useSubBlockStore.getState()

  // Try to get a saved API key for this provider
  const savedValue = toolParamsStore.resolveParamValue(provider, 'apiKey', blockId)

  // If we have a valid API key, use it
  if (savedValue && savedValue !== '') {
    // Only update if different from current value
    if (savedValue !== storeValue) {
      subBlockStore.setValue(blockId, subBlockId, savedValue)
    }
  } else {
    // No API key found for this provider - ALWAYS clear the field
    subBlockStore.setValue(blockId, subBlockId, '')
  }
}

/**
 * Helper to handle API key auto-fill for non-agent blocks
 */
function handleStandardBlockApiKey(
  blockId: string,
  subBlockId: string,
  blockType: string | undefined,
  storeValue: any
) {
  if (!blockType) return

  const toolParamsStore = useToolParamsStore.getState()

  // Only auto-fill if the field is empty
  if (!storeValue || storeValue === '') {
    // Pass the blockId as instanceId to check if this specific instance has been cleared
    const savedValue = toolParamsStore.resolveParamValue(blockType, 'apiKey', blockId)

    if (savedValue && savedValue !== '' && savedValue !== storeValue) {
      // Auto-fill the API key from the param store
      useSubBlockStore.getState().setValue(blockId, subBlockId, savedValue)
    }
  }
  // Handle environment variable references
  else if (
    storeValue &&
    typeof storeValue === 'string' &&
    storeValue.startsWith('{{') &&
    storeValue.endsWith('}}')
  ) {
    // Pass the blockId as instanceId
    const currentValue = toolParamsStore.resolveParamValue(blockType, 'apiKey', blockId)

    if (currentValue !== storeValue) {
      // If we got a replacement or null, update the field
      if (currentValue) {
        // Replacement found - update to new reference
        useSubBlockStore.getState().setValue(blockId, subBlockId, currentValue)
      }
    }
  }
}

/**
 * Helper to store API key values
 */
function storeApiKeyValue(
  blockId: string,
  blockType: string | undefined,
  modelValue: string | null | undefined,
  newValue: any,
  storeValue: any
) {
  if (!blockType) return

  const toolParamsStore = useToolParamsStore.getState()

  // Check if this is an empty value for an API key field that previously had a value
  // This indicates the user has deliberately cleared the field
  if (
    storeValue &&
    storeValue !== '' &&
    (newValue === null || newValue === '' || String(newValue).trim() === '')
  ) {
    // Mark this specific instance as cleared so we don't auto-fill it
    toolParamsStore.markParamAsCleared(blockId, 'apiKey')
    return
  }

  // Only store non-empty values
  if (!newValue || String(newValue).trim() === '') return

  // For agent blocks, store the API key under the provider name
  if (blockType === 'agent' && modelValue) {
    const provider = getProviderFromModel(modelValue)
    if (provider && provider !== 'ollama') {
      toolParamsStore.setParam(provider, 'apiKey', String(newValue))
    }
  } else {
    // For other blocks, store under the block type
    toolParamsStore.setParam(blockType, 'apiKey', String(newValue))
  }
}

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
  const blockType = useWorkflowStore(
    useCallback((state) => state.blocks?.[blockId]?.type, [blockId])
  )

  const initialValue = useWorkflowStore(
    useCallback(
      (state) => state.blocks?.[blockId]?.subBlocks?.[subBlockId]?.value ?? null,
      [blockId, subBlockId]
    )
  )

  // Keep a ref to the latest value to prevent unnecessary re-renders
  const valueRef = useRef<T | null>(null)

  // Previous model reference for detecting model changes
  const prevModelRef = useRef<string | null>(null)

  // Get value from subblock store - always call this hook unconditionally
  const storeValue = useSubBlockStore(
    useCallback((state) => state.getValue(blockId, subBlockId), [blockId, subBlockId])
  )

  // Check if this is an API key field that could be auto-filled
  const isApiKey =
    subBlockId === 'apiKey' || (subBlockId?.toLowerCase().includes('apikey') ?? false)

  // Check if auto-fill environment variables is enabled - always call this hook unconditionally
  const isAutoFillEnvVarsEnabled = useGeneralStore((state) => state.isAutoFillEnvVarsEnabled)

  // Always call this hook unconditionally - don't wrap it in a condition
  const modelSubBlockValue = useSubBlockStore((state) =>
    blockId ? state.getValue(blockId, 'model') : null
  )

  // Compute the modelValue after the hook call
  const modelValue = blockType === 'agent' ? (modelSubBlockValue as string) : null

  // When model changes for an agent block's API key, immediately check if we need to clear it
  useEffect(() => {
    // Only run for agent blocks with API key fields when model changes
    if (blockType === 'agent' && isApiKey && modelValue !== prevModelRef.current) {
      // Update the previous model reference
      prevModelRef.current = modelValue

      // Handle API key autofill for the new model
      if (isAutoFillEnvVarsEnabled && modelValue) {
        handleAgentBlockApiKey(blockId, subBlockId, modelValue, storeValue)
      }
    }
  }, [blockId, subBlockId, blockType, isApiKey, modelValue, isAutoFillEnvVarsEnabled, storeValue])

  // When component mounts, check for existing API key in toolParamsStore
  useEffect(() => {
    // Skip autofill if the feature is disabled in settings
    if (!isAutoFillEnvVarsEnabled) return

    // Only process API key fields
    if (!isApiKey) return

    // Handle agent blocks differently, they need to use the model to determine provider
    if (blockType === 'agent') {
      handleAgentBlockApiKey(blockId, subBlockId, modelValue, storeValue)
    } else {
      // Normal handling for non-agent blocks
      handleStandardBlockApiKey(blockId, subBlockId, blockType, storeValue)
    }
  }, [blockId, subBlockId, blockType, storeValue, isApiKey, isAutoFillEnvVarsEnabled, modelValue])

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

        // Handle API key storage for reuse across blocks
        if (isApiKey && blockType) {
          storeApiKeyValue(blockId, blockType, modelValue, newValue, storeValue)
        }

        // Update the subblock store with the new value
        // The store's setValue method will now trigger the debounced sync automatically
        useSubBlockStore.getState().setValue(blockId, subBlockId, valueCopy)

        if (triggerWorkflowUpdate) {
          useWorkflowStore.getState().triggerUpdate()
        }
      }
    },
    [blockId, subBlockId, blockType, isApiKey, storeValue, triggerWorkflowUpdate, modelValue]
  )

  // Return the current value and setter
  return [valueRef.current as T | null, setValue] as const
}
