import { useCallback, useEffect, useRef } from 'react'
import { isEqual } from 'lodash'
import { createLogger } from '@/lib/logs/console-logger'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { getProviderFromModel } from '@/providers/utils'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('SubBlockValue')

// Helper function to dispatch collaborative subblock updates
const dispatchSubblockUpdate = (blockId: string, subBlockId: string, value: any) => {
  const event = new CustomEvent('update-subblock-value', {
    detail: {
      blockId,
      subBlockId,
      value,
    },
  })
  window.dispatchEvent(event)
}

/**
 * Helper to handle API key auto-fill for provider-based blocks
 * Used for agent, router, evaluator, and any other blocks that use LLM providers
 */
function handleProviderBasedApiKey(
  blockId: string,
  subBlockId: string,
  modelValue: string | null | undefined,
  storeValue: any,
  isModelChange = false
) {
  // Only proceed if we have a model selected
  if (!modelValue) return

  // Get the provider for this model
  const provider = getProviderFromModel(modelValue)

  // Skip if we couldn't determine a provider
  if (!provider || provider === 'ollama') return

  const subBlockStore = useSubBlockStore.getState()
  const isAutoFillEnabled = useGeneralStore.getState().isAutoFillEnvVarsEnabled

  // Try to get a saved API key for this provider (only if auto-fill is enabled)
  const savedValue = isAutoFillEnabled
    ? subBlockStore.resolveToolParamValue(provider, 'apiKey', blockId)
    : null

  // If we have a valid saved API key and auto-fill is enabled, use it
  if (savedValue && savedValue !== '' && isAutoFillEnabled) {
    // Only update if the current value is different to avoid unnecessary updates
    if (storeValue !== savedValue) {
      dispatchSubblockUpdate(blockId, subBlockId, savedValue)
    }
  } else if (isModelChange && (!storeValue || storeValue === '')) {
    // Only clear the field when switching models AND the field is already empty
    // Don't clear existing user-entered values on initial load
    dispatchSubblockUpdate(blockId, subBlockId, '')
  }
  // If no saved value and this is initial load, preserve existing value
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

  const subBlockStore = useSubBlockStore.getState()

  // Only auto-fill if the field is empty
  if (!storeValue || storeValue === '') {
    // Pass the blockId as instanceId to check if this specific instance has been cleared
    const savedValue = subBlockStore.resolveToolParamValue(blockType, 'apiKey', blockId)

    if (savedValue && savedValue !== '' && savedValue !== storeValue) {
      // Auto-fill the API key from the param store
      dispatchSubblockUpdate(blockId, subBlockId, savedValue)
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
    const currentValue = subBlockStore.resolveToolParamValue(blockType, 'apiKey', blockId)

    if (currentValue !== storeValue) {
      // If we got a replacement or null, update the field
      if (currentValue) {
        // Replacement found - update to new reference
        dispatchSubblockUpdate(blockId, subBlockId, currentValue)
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

  const subBlockStore = useSubBlockStore.getState()

  // Check if this is user explicitly clearing a field that had a value
  // We only want to mark it as cleared if it's a user action, not an automatic
  // clearing from model switching
  if (
    storeValue &&
    storeValue !== '' &&
    (newValue === null || newValue === '' || String(newValue).trim() === '')
  ) {
    // Mark this specific instance as cleared so we don't auto-fill it
    subBlockStore.markParamAsCleared(blockId, 'apiKey')
    return
  }

  // Only store non-empty values
  if (!newValue || String(newValue).trim() === '') return

  // If user enters a value, we should clear any "cleared" flag
  // to ensure auto-fill will work in the future
  if (subBlockStore.isParamCleared(blockId, 'apiKey')) {
    subBlockStore.unmarkParamAsCleared(blockId, 'apiKey')
  }

  // For provider-based blocks, store the API key under the provider name
  if (
    (blockType === 'agent' || blockType === 'router' || blockType === 'evaluator') &&
    modelValue
  ) {
    const provider = getProviderFromModel(modelValue)
    if (provider && provider !== 'ollama') {
      subBlockStore.setToolParam(provider, 'apiKey', String(newValue))
    }
  } else {
    // For other blocks, store under the block type
    subBlockStore.setToolParam(blockType, 'apiKey', String(newValue))
  }
}

interface UseSubBlockValueOptions {
  debounceMs?: number
  isStreaming?: boolean // Explicit streaming state
  onStreamingEnd?: () => void
}

/**
 * Custom hook to get and set values for a sub-block in a workflow.
 * Handles complex object values properly by using deep equality comparison.
 * Includes automatic debouncing and explicit streaming mode for AI generation.
 *
 * @param blockId The ID of the block containing the sub-block
 * @param subBlockId The ID of the sub-block
 * @param triggerWorkflowUpdate Whether to trigger a workflow update when the value changes
 * @param options Configuration for debouncing and streaming behavior
 * @returns A tuple containing the current value and setter function
 */
export function useSubBlockValue<T = any>(
  blockId: string,
  subBlockId: string,
  triggerWorkflowUpdate = false,
  options?: UseSubBlockValueOptions
): readonly [T | null, (value: T) => void] {
  const { isStreaming = false, onStreamingEnd } = options || {}

  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()

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

  // Streaming refs
  const lastEmittedValueRef = useRef<T | null>(null)
  const streamingValueRef = useRef<T | null>(null)
  const wasStreamingRef = useRef<boolean>(false)

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

  // Determine if this is a provider-based block type
  const isProviderBasedBlock =
    blockType === 'agent' || blockType === 'router' || blockType === 'evaluator'

  // Compute the modelValue based on block type
  const modelValue = isProviderBasedBlock ? (modelSubBlockValue as string) : null

  // Emit the value to socket/DB
  const emitValue = useCallback(
    (value: T) => {
      collaborativeSetSubblockValue(blockId, subBlockId, value)
      lastEmittedValueRef.current = value
    },
    [blockId, subBlockId, collaborativeSetSubblockValue]
  )

  // Handle streaming mode changes
  useEffect(() => {
    // If we just exited streaming mode, emit the final value
    if (wasStreamingRef.current && !isStreaming && streamingValueRef.current !== null) {
      logger.debug('Streaming ended, persisting final value', { blockId, subBlockId })
      emitValue(streamingValueRef.current)
      streamingValueRef.current = null
      onStreamingEnd?.()
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming, blockId, subBlockId, emitValue, onStreamingEnd])

  // Hook to set a value in the subblock store
  const setValue = useCallback(
    (newValue: T) => {
      // Use deep comparison to avoid unnecessary updates for complex objects
      if (!isEqual(valueRef.current, newValue)) {
        valueRef.current = newValue

        // Update local store immediately for UI responsiveness
        // The collaborative function will also update it, but that's okay for idempotency
        useSubBlockStore.setState((state) => ({
          workflowValues: {
            ...state.workflowValues,
            [useWorkflowRegistry.getState().activeWorkflowId || '']: {
              ...state.workflowValues[useWorkflowRegistry.getState().activeWorkflowId || ''],
              [blockId]: {
                ...state.workflowValues[useWorkflowRegistry.getState().activeWorkflowId || '']?.[
                  blockId
                ],
                [subBlockId]: newValue,
              },
            },
          },
        }))

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

        // If streaming, just store the value without emitting
        if (isStreaming) {
          streamingValueRef.current = valueCopy
        } else {
          // Emit immediately - let the operation queue handle debouncing and deduplication
          emitValue(valueCopy)
        }

        if (triggerWorkflowUpdate) {
          useWorkflowStore.getState().triggerUpdate()
        }
      }
    },
    [
      blockId,
      subBlockId,
      blockType,
      isApiKey,
      storeValue,
      triggerWorkflowUpdate,
      modelValue,
      isStreaming,
      emitValue,
    ]
  )

  // Initialize valueRef on first render
  useEffect(() => {
    valueRef.current = storeValue !== undefined ? storeValue : initialValue
  }, [])

  // When component mounts, check for existing API key in toolParamsStore
  useEffect(() => {
    // Skip autofill if the feature is disabled in settings
    if (!isAutoFillEnvVarsEnabled) return

    // Only process API key fields
    if (!isApiKey) return

    // Handle different block types
    if (isProviderBasedBlock) {
      handleProviderBasedApiKey(blockId, subBlockId, modelValue, storeValue, false)
    } else {
      // Normal handling for non-provider blocks
      handleStandardBlockApiKey(blockId, subBlockId, blockType, storeValue)
    }
  }, [
    blockId,
    subBlockId,
    blockType,
    storeValue,
    isApiKey,
    isAutoFillEnvVarsEnabled,
    modelValue,
    isProviderBasedBlock,
  ])

  // Monitor for model changes in provider-based blocks
  useEffect(() => {
    // Only process API key fields in model-based blocks
    if (!isApiKey || !isProviderBasedBlock) return

    // Check if the model has changed
    if (modelValue !== prevModelRef.current) {
      // Update the previous model reference
      prevModelRef.current = modelValue

      // Handle API key auto-fill for model changes
      if (modelValue) {
        handleProviderBasedApiKey(blockId, subBlockId, modelValue, storeValue, true)
      } else {
        // If no model is selected, clear the API key field
        dispatchSubblockUpdate(blockId, subBlockId, '')
      }
    }
  }, [
    blockId,
    subBlockId,
    blockType,
    isApiKey,
    modelValue,
    isAutoFillEnvVarsEnabled,
    storeValue,
    isProviderBasedBlock,
  ])

  // Update the ref if the store value changes
  // This ensures we're always working with the latest value
  useEffect(() => {
    // Use deep comparison for objects to prevent unnecessary updates
    if (!isEqual(valueRef.current, storeValue)) {
      valueRef.current = storeValue !== undefined ? storeValue : initialValue
    }
  }, [storeValue, initialValue])

  // Return appropriate tuple based on whether options were provided
  return [storeValue !== undefined ? storeValue : initialValue, setValue] as const
}
