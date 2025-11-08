import { useCallback, useEffect, useRef } from 'react'
import { isEqual } from 'lodash'
import { createLogger } from '@/lib/logs/console/logger'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { getProviderFromModel } from '@/providers/utils'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('SubBlockValue')

interface UseSubBlockValueOptions {
  isStreaming?: boolean
  onStreamingEnd?: () => void
}

/**
 * Custom hook to get and set values for a sub-block in a workflow.
 * Handles complex object values properly by using deep equality comparison.
 * Supports explicit streaming mode for AI generation.
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

  // Subscribe to active workflow id to avoid races where the workflow id is set after mount.
  // This ensures our selector recomputes when the active workflow changes.
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)

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

  // Streaming refs
  const lastEmittedValueRef = useRef<T | null>(null)
  const streamingValueRef = useRef<T | null>(null)
  const wasStreamingRef = useRef<boolean>(false)

  // Get value from subblock store, keyed by active workflow id
  // Optimized: use shallow equality comparison to prevent re-renders when other fields change
  const storeValue = useSubBlockStore(
    useCallback(
      (state) => {
        // If the active workflow ID isn't available yet, return undefined so we can fall back to initialValue
        if (!activeWorkflowId) return undefined
        return state.workflowValues[activeWorkflowId]?.[blockId]?.[subBlockId] ?? null
      },
      [activeWorkflowId, blockId, subBlockId]
    ),
    (a, b) => isEqual(a, b) // Use deep equality to prevent re-renders for same values
  )

  // Check if we're in diff mode and get diff value if available
  const { isShowingDiff, diffWorkflow } = useWorkflowDiffStore()
  const diffValue =
    isShowingDiff && diffWorkflow
      ? (diffWorkflow.blocks?.[blockId]?.subBlocks?.[subBlockId]?.value ?? null)
      : null

  // Check if this is an API key field that could be auto-filled
  const isApiKey =
    subBlockId === 'apiKey' || (subBlockId?.toLowerCase().includes('apikey') ?? false)

  // Always call this hook unconditionally - don't wrap it in a condition
  // Optimized: only re-render if model value actually changes
  const modelSubBlockValue = useSubBlockStore(
    useCallback((state) => (blockId ? state.getValue(blockId, 'model') : null), [blockId]),
    (a, b) => a === b
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
      // Don't allow updates when in diff mode (readonly preview)
      if (isShowingDiff) {
        logger.debug('Ignoring setValue in diff mode', { blockId, subBlockId })
        return
      }

      const currentActiveWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (!currentActiveWorkflowId) {
        logger.warn('No active workflow ID when setting value', { blockId, subBlockId })
        return
      }

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

        // If streaming, hold value locally and do not update global store to avoid render-phase updates
        if (isStreaming) {
          streamingValueRef.current = valueCopy
          return
        }

        // Update local store immediately for UI responsiveness (non-streaming)
        useSubBlockStore.setState((state) => ({
          workflowValues: {
            ...state.workflowValues,
            [currentActiveWorkflowId]: {
              ...state.workflowValues[currentActiveWorkflowId],
              [blockId]: {
                ...state.workflowValues[currentActiveWorkflowId]?.[blockId],
                [subBlockId]: newValue,
              },
            },
          },
        }))

        // Handle model changes for provider-based blocks - clear API key when provider changes (non-streaming)
        if (
          subBlockId === 'model' &&
          isProviderBasedBlock &&
          newValue &&
          typeof newValue === 'string'
        ) {
          const currentApiKeyValue = useSubBlockStore.getState().getValue(blockId, 'apiKey')
          if (currentApiKeyValue && currentApiKeyValue !== '') {
            const oldModelValue = storeValue as string
            const oldProvider = oldModelValue ? getProviderFromModel(oldModelValue) : null
            const newProvider = getProviderFromModel(newValue)
            if (oldProvider !== newProvider) {
              collaborativeSetSubblockValue(blockId, 'apiKey', '')
            }
          }
        }

        // Emit immediately; the client queue coalesces same-key ops and the server debounces
        emitValue(valueCopy)

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
      isShowingDiff,
    ]
  )

  // Determine the effective value: diff value takes precedence if in diff mode
  const effectiveValue =
    isShowingDiff && diffValue !== null
      ? diffValue
      : storeValue !== undefined
        ? storeValue
        : initialValue

  // Initialize valueRef on first render
  useEffect(() => {
    valueRef.current = effectiveValue
  }, [])

  // Update the ref if the effective value changes
  // This ensures we're always working with the latest value
  useEffect(() => {
    // Use deep comparison for objects to prevent unnecessary updates
    if (!isEqual(valueRef.current, effectiveValue)) {
      valueRef.current = effectiveValue
    }
  }, [effectiveValue])

  // Return appropriate tuple based on whether options were provided
  return [effectiveValue, setValue] as const
}
