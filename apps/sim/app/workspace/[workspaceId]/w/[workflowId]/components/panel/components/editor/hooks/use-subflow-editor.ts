import { useCallback, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { highlight, languages } from '@/components/emcn'
import {
  isLikelyReferenceSegment,
  SYSTEM_REFERENCE_PREFIXES,
  splitReferenceSegment,
} from '@/lib/workflows/sanitization/references'
import { checkTagTrigger } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { normalizeName, REFERENCE } from '@/executor/constants'
import { createEnvVarPattern, createReferencePattern } from '@/executor/utils/reference-validation'
import { createShouldHighlightEnvVar, useAvailableEnvVarKeys } from '@/hooks/use-available-env-vars'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Configuration for subflow types (loop and parallel)
 */
const SUBFLOW_CONFIG = {
  loop: {
    typeLabels: {
      for: 'For Loop',
      forEach: 'For Each',
      while: 'While Loop',
      doWhile: 'Do While Loop',
    },
    typeKey: 'loopType' as const,
    storeKey: 'loops' as const,
    maxIterations: 1000,
    configKeys: {
      iterations: 'iterations' as const,
      items: 'forEachItems' as const,
      condition: 'whileCondition' as const,
    } as any,
  },
  parallel: {
    typeLabels: { count: 'Parallel Count', collection: 'Parallel Each' },
    typeKey: 'parallelType' as const,
    storeKey: 'parallels' as const,
    maxIterations: 20,
    configKeys: {
      iterations: 'count' as const,
      items: 'distribution' as const,
    },
  },
} as const

/**
 * Hook for managing subflow editor state and logic
 *
 * @param currentBlock - The current block being edited
 * @param currentBlockId - The ID of the current block
 * @returns Subflow editor state and handlers
 */
export function useSubflowEditor(currentBlock: BlockState | null, currentBlockId: string | null) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  const [tempInputValue, setTempInputValue] = useState<string | null>(null)
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)

  const isSubflow =
    currentBlock && (currentBlock.type === 'loop' || currentBlock.type === 'parallel')

  const subflowConfig = isSubflow ? SUBFLOW_CONFIG[currentBlock.type as 'loop' | 'parallel'] : null

  const nodeConfig = useWorkflowStore(
    useCallback(
      (state) => {
        if (!isSubflow || !subflowConfig || !currentBlockId) return null
        return state[subflowConfig.storeKey][currentBlockId] ?? null
      },
      [isSubflow, subflowConfig, currentBlockId]
    )
  )

  // Get block data for fallback values
  const blockData = isSubflow ? currentBlock?.data : null

  // Get accessible prefixes for tag dropdown
  const accessiblePrefixes = useAccessibleReferencePrefixes(currentBlockId || '')

  // Get available env vars for highlighting validation
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId)
  const shouldHighlightEnvVar = useMemo(
    () => createShouldHighlightEnvVar(availableEnvVars),
    [availableEnvVars]
  )

  // Collaborative actions
  const {
    collaborativeUpdateLoopType,
    collaborativeUpdateParallelType,
    collaborativeUpdateIterationCount,
    collaborativeUpdateIterationCollection,
  } = useCollaborativeWorkflow()

  /**
   * Checks if a reference should be highlighted based on accessible prefixes
   */
  const shouldHighlightReference = useCallback(
    (part: string): boolean => {
      if (!part.startsWith(REFERENCE.START) || !part.endsWith(REFERENCE.END)) {
        return false
      }

      if (!isLikelyReferenceSegment(part)) {
        return false
      }

      const split = splitReferenceSegment(part)
      if (!split) {
        return false
      }

      const reference = split.reference

      if (!accessiblePrefixes) {
        return true
      }

      const inner = reference.slice(REFERENCE.START.length, -REFERENCE.END.length)
      const [prefix] = inner.split(REFERENCE.PATH_DELIMITER)
      const normalizedPrefix = normalizeName(prefix)

      if (SYSTEM_REFERENCE_PREFIXES.has(normalizedPrefix)) {
        return true
      }

      return accessiblePrefixes.has(normalizedPrefix)
    },
    [accessiblePrefixes]
  )

  /**
   * Highlights code with references and environment variables
   */
  const highlightWithReferences = useCallback(
    (code: string): string => {
      const placeholders: Array<{
        placeholder: string
        original: string
        type: 'var' | 'env'
      }> = []

      let processedCode = code

      processedCode = processedCode.replace(createEnvVarPattern(), (match) => {
        const varName = match.slice(2, -2).trim()
        if (shouldHighlightEnvVar(varName)) {
          const placeholder = `__ENV_VAR_${placeholders.length}__`
          placeholders.push({ placeholder, original: match, type: 'env' })
          return placeholder
        }
        return match
      })

      // Use [^<>]+ to prevent matching across nested brackets (e.g., "<3 <real.ref>" should match separately)
      processedCode = processedCode.replace(createReferencePattern(), (match) => {
        if (shouldHighlightReference(match)) {
          const placeholder = `__VAR_REF_${placeholders.length}__`
          placeholders.push({ placeholder, original: match, type: 'var' })
          return placeholder
        }
        return match
      })

      let highlightedCode = highlight(processedCode, languages.javascript, 'javascript')

      placeholders.forEach(({ placeholder, original, type }) => {
        if (type === 'env') {
          highlightedCode = highlightedCode.replace(
            placeholder,
            `<span style="color: var(--brand-secondary);">${original}</span>`
          )
        } else {
          const escaped = original.replace(/</g, '&lt;').replace(/>/g, '&gt;')
          highlightedCode = highlightedCode.replace(
            placeholder,
            `<span style="color: var(--brand-secondary);">${escaped}</span>`
          )
        }
      })

      return highlightedCode
    },
    [shouldHighlightReference, shouldHighlightEnvVar]
  )

  /**
   * Handle subflow type change (loop type or parallel type)
   */
  const handleSubflowTypeChange = useCallback(
    (newType: string) => {
      if (!currentBlockId || !isSubflow || !currentBlock) return
      if (currentBlock.type === 'loop') {
        collaborativeUpdateLoopType(
          currentBlockId,
          newType as 'for' | 'forEach' | 'while' | 'doWhile'
        )
      } else {
        collaborativeUpdateParallelType(currentBlockId, newType as 'count' | 'collection')
      }
    },
    [
      currentBlockId,
      isSubflow,
      currentBlock,
      collaborativeUpdateLoopType,
      collaborativeUpdateParallelType,
    ]
  )

  /**
   * Handle iterations input change
   */
  const handleSubflowIterationsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!subflowConfig) return
      const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
      const numValue = Number.parseInt(sanitizedValue)

      if (!Number.isNaN(numValue)) {
        setTempInputValue(Math.min(subflowConfig.maxIterations, numValue).toString())
      } else {
        setTempInputValue(sanitizedValue)
      }
    },
    [subflowConfig]
  )

  /**
   * Save iterations value
   */
  const handleSubflowIterationsSave = useCallback(() => {
    if (!currentBlockId || !isSubflow || !subflowConfig || !currentBlock) return
    const value = Number.parseInt(tempInputValue ?? '5')

    if (!Number.isNaN(value)) {
      const newValue = Math.min(subflowConfig.maxIterations, Math.max(1, value))
      collaborativeUpdateIterationCount(
        currentBlockId,
        currentBlock.type as 'loop' | 'parallel',
        newValue
      )
    }
    setTempInputValue(null)
  }, [
    tempInputValue,
    currentBlockId,
    isSubflow,
    subflowConfig,
    currentBlock,
    collaborativeUpdateIterationCount,
  ])

  /**
   * Handle editor value change (collection/condition)
   */
  const handleSubflowEditorChange = useCallback(
    (value: string) => {
      if (!currentBlockId || !isSubflow || !currentBlock) return
      collaborativeUpdateIterationCollection(
        currentBlockId,
        currentBlock.type as 'loop' | 'parallel',
        value
      )

      const textarea = editorContainerRef.current?.querySelector('textarea')
      if (textarea) {
        textareaRef.current = textarea
        const cursorPos = textarea.selectionStart || 0
        setCursorPosition(cursorPos)

        const triggerCheck = checkTagTrigger(value, cursorPos)
        setShowTagDropdown(triggerCheck.show)
      }
    },
    [currentBlockId, isSubflow, currentBlock, collaborativeUpdateIterationCollection]
  )

  /**
   * Handle tag selection from dropdown
   */
  const handleSubflowTagSelect = useCallback(
    (newValue: string) => {
      if (!currentBlockId || !isSubflow || !currentBlock) return
      collaborativeUpdateIterationCollection(
        currentBlockId,
        currentBlock.type as 'loop' | 'parallel',
        newValue
      )
      setShowTagDropdown(false)

      setTimeout(() => {
        const textarea = textareaRef.current
        if (textarea) {
          textarea.focus()
        }
      }, 0)
    },
    [currentBlockId, isSubflow, currentBlock, collaborativeUpdateIterationCollection]
  )

  // Compute derived values
  const currentType =
    isSubflow && subflowConfig
      ? (nodeConfig as any)?.[subflowConfig.typeKey] ||
        (blockData as any)?.[subflowConfig.typeKey] ||
        (currentBlock!.type === 'loop' ? 'for' : 'count')
      : null

  const isCountMode = currentType === 'for' || currentType === 'count'
  const isConditionMode = currentType === 'while' || currentType === 'doWhile'

  const configIterations =
    isSubflow && subflowConfig
      ? ((nodeConfig as any)?.[subflowConfig.configKeys.iterations] ??
        (blockData as any)?.count ??
        5)
      : 5

  const configCollection =
    isSubflow && subflowConfig
      ? ((nodeConfig as any)?.[subflowConfig.configKeys.items] ??
        (blockData as any)?.collection ??
        '')
      : ''

  const conditionKey =
    currentType === 'while'
      ? 'whileCondition'
      : currentType === 'doWhile'
        ? 'doWhileCondition'
        : null

  const configCondition =
    isSubflow && conditionKey
      ? ((nodeConfig as any)?.[conditionKey] ?? (blockData as any)?.[conditionKey] ?? '')
      : ''

  const iterations = configIterations
  const collectionString =
    typeof configCollection === 'string' ? configCollection : JSON.stringify(configCollection) || ''
  const conditionString = typeof configCondition === 'string' ? configCondition : ''

  const inputValue = tempInputValue ?? iterations.toString()
  const editorValue = isConditionMode ? conditionString : collectionString

  // Type options for combobox
  const typeOptions =
    isSubflow && subflowConfig
      ? Object.entries(subflowConfig.typeLabels).map(([value, label]) => ({
          value,
          label,
        }))
      : []

  return {
    // State
    isSubflow,
    subflowConfig,
    currentType,
    isCountMode,
    isConditionMode,
    inputValue,
    editorValue,
    typeOptions,
    showTagDropdown,
    cursorPosition,
    textareaRef,
    editorContainerRef,

    // Handlers
    handleSubflowTypeChange,
    handleSubflowIterationsChange,
    handleSubflowIterationsSave,
    handleSubflowEditorChange,
    handleSubflowTagSelect,
    highlightWithReferences,
    setShowTagDropdown,
  }
}
