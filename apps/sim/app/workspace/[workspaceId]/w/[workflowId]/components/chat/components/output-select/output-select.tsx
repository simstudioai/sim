'use client'

import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, RepeatIcon, SplitIcon } from 'lucide-react'
import {
  Badge,
  Popover,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
  PopoverTrigger,
} from '@/components/emcn'
import {
  extractFieldsFromSchema,
  parseResponseFormatSafely,
} from '@/lib/core/utils/response-format'
import { getBlock } from '@/blocks'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Renders a tag icon with background color.
 *
 * @param icon - Either a letter string or a Lucide icon component
 * @param color - Background color for the icon container
 * @returns A styled icon element
 */
const TagIcon: React.FC<{
  icon: string | React.ComponentType<{ className?: string }>
  color: string
}> = ({ icon, color }) => (
  <div
    className='flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded'
    style={{ background: color }}
  >
    {typeof icon === 'string' ? (
      <span className='!text-white font-bold text-[10px]'>{icon}</span>
    ) : (
      (() => {
        const IconComponent = icon
        return <IconComponent className='!text-white size-[9px]' />
      })()
    )}
  </div>
)

/**
 * Props for the OutputSelect component
 */
interface OutputSelectProps {
  /** The workflow ID to fetch outputs from */
  workflowId: string | null
  /** Array of currently selected output IDs or labels */
  selectedOutputs: string[]
  /** Callback fired when output selection changes */
  onOutputSelect: (outputIds: string[]) => void
  /** Whether the select is disabled */
  disabled?: boolean
  /** Placeholder text when no outputs are selected */
  placeholder?: string
  /** Whether to emit output IDs or labels in onOutputSelect callback */
  valueMode?: 'id' | 'label'
  /**
   * When true, renders the underlying popover content inline instead of in a portal.
   * Useful when used inside dialogs or other portalled components that manage scroll locking.
   */
  disablePopoverPortal?: boolean
  /** Alignment of the popover relative to the trigger */
  align?: 'start' | 'end' | 'center'
  /** Maximum height of the popover content in pixels */
  maxHeight?: number
}

/**
 * OutputSelect component for selecting workflow block outputs
 *
 * Displays a dropdown menu of all available workflow outputs grouped by block.
 * Supports multi-selection, keyboard navigation, and shows visual indicators
 * for selected outputs.
 *
 * @param props - Component props
 * @returns The OutputSelect component
 */
export function OutputSelect({
  workflowId,
  selectedOutputs = [],
  onOutputSelect,
  disabled = false,
  placeholder = 'Select outputs',
  valueMode = 'id',
  disablePopoverPortal = false,
  align = 'start',
  maxHeight = 200,
}: OutputSelectProps) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const blocks = useWorkflowStore((state) => state.blocks)
  const { isShowingDiff, isDiffReady, hasActiveDiff, baselineWorkflow } = useWorkflowDiffStore()
  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? state.workflowValues[workflowId] : null
  )

  /**
   * Uses diff blocks when in diff mode, otherwise main blocks
   */
  const shouldUseBaseline = hasActiveDiff && isDiffReady && !isShowingDiff && baselineWorkflow
  const workflowBlocks =
    shouldUseBaseline && baselineWorkflow ? baselineWorkflow.blocks : (blocks as any)

  /**
   * Extracts all available workflow outputs for the dropdown
   */
  const workflowOutputs = useMemo(() => {
    const outputs: Array<{
      id: string
      label: string
      blockId: string
      blockName: string
      blockType: string
      path: string
    }> = []

    if (!workflowId || !workflowBlocks || typeof workflowBlocks !== 'object') {
      return outputs
    }

    const blockArray = Object.values(workflowBlocks)
    if (blockArray.length === 0) return outputs

    blockArray.forEach((block: any) => {
      if (block.type === 'starter' || !block?.id || !block?.type) return

      const blockName =
        block.name && typeof block.name === 'string'
          ? block.name.replace(/\s+/g, '').toLowerCase()
          : `block-${block.id}`

      const blockConfig = getBlock(block.type)
      const responseFormatValue =
        shouldUseBaseline && baselineWorkflow
          ? baselineWorkflow.blocks?.[block.id]?.subBlocks?.responseFormat?.value
          : subBlockValues?.[block.id]?.responseFormat
      const responseFormat = parseResponseFormatSafely(responseFormatValue, block.id)

      let outputsToProcess: Record<string, unknown> = {}

      if (responseFormat) {
        const schemaFields = extractFieldsFromSchema(responseFormat)
        if (schemaFields.length > 0) {
          schemaFields.forEach((field) => {
            outputsToProcess[field.name] = { type: field.type }
          })
        } else {
          outputsToProcess = blockConfig?.outputs || {}
        }
      } else {
        outputsToProcess = blockConfig?.outputs || {}
      }

      if (Object.keys(outputsToProcess).length === 0) return

      const addOutput = (path: string, outputObj: unknown, prefix = '') => {
        const fullPath = prefix ? `${prefix}.${path}` : path
        const createOutput = () => ({
          id: `${block.id}_${fullPath}`,
          label: `${blockName}.${fullPath}`,
          blockId: block.id,
          blockName: block.name || `Block ${block.id}`,
          blockType: block.type,
          path: fullPath,
        })

        if (
          typeof outputObj !== 'object' ||
          outputObj === null ||
          ('type' in outputObj && typeof outputObj.type === 'string') ||
          Array.isArray(outputObj)
        ) {
          outputs.push(createOutput())
          return
        }

        Object.entries(outputObj).forEach(([key, value]) => {
          addOutput(key, value, fullPath)
        })
      }

      Object.entries(outputsToProcess).forEach(([key, value]) => {
        addOutput(key, value)
      })
    })

    return outputs
  }, [
    workflowBlocks,
    workflowId,
    isShowingDiff,
    isDiffReady,
    baselineWorkflow,
    blocks,
    subBlockValues,
    shouldUseBaseline,
  ])

  /**
   * Checks if an output is currently selected by comparing both ID and label
   * @param o - The output object to check
   * @returns True if the output is selected, false otherwise
   */
  const isSelectedValue = useCallback(
    (o: { id: string; label: string }) =>
      selectedOutputs.includes(o.id) || selectedOutputs.includes(o.label),
    [selectedOutputs]
  )

  /**
   * Gets display text for selected outputs
   */
  const selectedOutputsDisplayText = useMemo(() => {
    if (!selectedOutputs || selectedOutputs.length === 0) {
      return placeholder
    }

    const validOutputs = selectedOutputs.filter((val) =>
      workflowOutputs.some((o) => o.id === val || o.label === val)
    )

    if (validOutputs.length === 0) {
      return placeholder
    }

    if (validOutputs.length === 1) {
      const output = workflowOutputs.find(
        (o) => o.id === validOutputs[0] || o.label === validOutputs[0]
      )
      return output?.label || placeholder
    }

    return `${validOutputs.length} outputs`
  }, [selectedOutputs, workflowOutputs, placeholder])

  /**
   * Groups outputs by block and sorts by distance from starter block
   */
  const groupedOutputs = useMemo(() => {
    const groups: Record<string, typeof workflowOutputs> = {}
    const blockDistances: Record<string, number> = {}
    const edges = useWorkflowStore.getState().edges

    const starterBlock = Object.values(blocks).find((block) => block.type === 'starter')
    const starterBlockId = starterBlock?.id

    if (starterBlockId) {
      const adjList: Record<string, string[]> = {}
      edges.forEach((edge) => {
        if (!adjList[edge.source]) adjList[edge.source] = []
        adjList[edge.source].push(edge.target)
      })

      const visited = new Set<string>()
      const queue: Array<[string, number]> = [[starterBlockId, 0]]

      while (queue.length > 0) {
        const [currentNodeId, distance] = queue.shift()!
        if (visited.has(currentNodeId)) continue

        visited.add(currentNodeId)
        blockDistances[currentNodeId] = distance

        const outgoingNodeIds = adjList[currentNodeId] || []
        outgoingNodeIds.forEach((targetId) => {
          queue.push([targetId, distance + 1])
        })
      }
    }

    workflowOutputs.forEach((output) => {
      if (!groups[output.blockName]) groups[output.blockName] = []
      groups[output.blockName].push(output)
    })

    return Object.entries(groups)
      .map(([blockName, outputs]) => ({
        blockName,
        outputs,
        distance: blockDistances[outputs[0]?.blockId] || 0,
      }))
      .sort((a, b) => b.distance - a.distance)
      .reduce(
        (acc, { blockName, outputs }) => {
          acc[blockName] = outputs
          return acc
        },
        {} as Record<string, typeof workflowOutputs>
      )
  }, [workflowOutputs, blocks])

  /**
   * Gets the background color for a block output based on its type
   * @param blockId - The block ID (unused but kept for future extensibility)
   * @param blockType - The type of the block
   * @returns The hex color code for the block
   */
  const getOutputColor = (blockId: string, blockType: string) => {
    const blockConfig = getBlock(blockType)
    return blockConfig?.bgColor || '#2F55FF'
  }

  /**
   * Flattened outputs for keyboard navigation
   */
  const flattenedOutputs = useMemo(() => {
    return Object.values(groupedOutputs).flat()
  }, [groupedOutputs])

  /**
   * Handles output selection by toggling the selected state
   * @param value - The output label to toggle
   */
  const handleOutputSelection = useCallback(
    (value: string) => {
      const emittedValue =
        valueMode === 'label' ? value : workflowOutputs.find((o) => o.label === value)?.id || value
      const index = selectedOutputs.indexOf(emittedValue)

      const newSelectedOutputs =
        index === -1
          ? [...new Set([...selectedOutputs, emittedValue])]
          : selectedOutputs.filter((id) => id !== emittedValue)

      onOutputSelect(newSelectedOutputs)
    },
    [valueMode, workflowOutputs, selectedOutputs, onOutputSelect]
  )

  /**
   * Handles keyboard navigation within the output list
   * Supports ArrowUp, ArrowDown, Enter, and Escape keys
   */
  useEffect(() => {
    if (!open || flattenedOutputs.length === 0) return

    const handleKeyboardEvent = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setHighlightedIndex((prev) => {
            if (prev === -1 || prev >= flattenedOutputs.length - 1) {
              return 0
            }
            return prev + 1
          })
          break

        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setHighlightedIndex((prev) => {
            if (prev <= 0) {
              return flattenedOutputs.length - 1
            }
            return prev - 1
          })
          break

        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          setHighlightedIndex((currentIndex) => {
            if (currentIndex >= 0 && currentIndex < flattenedOutputs.length) {
              handleOutputSelection(flattenedOutputs[currentIndex].label)
            }
            return currentIndex
          })
          break

        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
          break
      }
    }

    window.addEventListener('keydown', handleKeyboardEvent, true)
    return () => window.removeEventListener('keydown', handleKeyboardEvent, true)
  }, [open, flattenedOutputs, handleOutputSelection])

  /**
   * Reset highlighted index when popover opens/closes
   */
  useEffect(() => {
    if (open) {
      const firstSelectedIndex = flattenedOutputs.findIndex((output) => isSelectedValue(output))
      setHighlightedIndex(firstSelectedIndex >= 0 ? firstSelectedIndex : -1)
    } else {
      setHighlightedIndex(-1)
    }
  }, [open, flattenedOutputs, isSelectedValue])

  /**
   * Scroll highlighted item into view
   */
  useEffect(() => {
    if (highlightedIndex >= 0 && popoverRef.current) {
      const highlightedElement = popoverRef.current.querySelector(
        `[data-option-index="${highlightedIndex}"]`
      )
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [highlightedIndex])

  /**
   * Closes popover when clicking outside
   */
  useEffect(() => {
    if (!open) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const insideTrigger = triggerRef.current?.contains(target)
      const insidePopover = popoverRef.current?.contains(target)

      if (!insideTrigger && !insidePopover) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <Popover open={open} variant='default'>
      <PopoverTrigger asChild>
        <div ref={triggerRef} className='min-w-0 max-w-full'>
          <Badge
            variant='outline'
            className='flex-none cursor-pointer whitespace-nowrap rounded-[6px]'
            title='Select outputs'
            aria-expanded={open}
            onMouseDown={(e) => {
              if (disabled || workflowOutputs.length === 0) return
              e.stopPropagation()
              setOpen((prev) => !prev)
            }}
          >
            <span className='whitespace-nowrap text-[12px]'>{selectedOutputsDisplayText}</span>
          </Badge>
        </div>
      </PopoverTrigger>
      <PopoverContent
        ref={popoverRef}
        side='bottom'
        align={align}
        sideOffset={4}
        maxHeight={maxHeight}
        maxWidth={300}
        minWidth={160}
        border
        disablePortal={disablePopoverPortal}
      >
        <div className='space-y-[2px]'>
          {Object.entries(groupedOutputs).map(([blockName, outputs], groupIndex, groupArray) => {
            const startIndex = flattenedOutputs.findIndex((o) => o.blockName === blockName)

            const firstOutput = outputs[0]
            const blockConfig = getBlock(firstOutput.blockType)
            const blockColor = getOutputColor(firstOutput.blockId, firstOutput.blockType)

            let blockIcon: string | React.ComponentType<{ className?: string }> = blockName
              .charAt(0)
              .toUpperCase()

            if (blockConfig?.icon) {
              blockIcon = blockConfig.icon
            } else if (firstOutput.blockType === 'loop') {
              blockIcon = RepeatIcon
            } else if (firstOutput.blockType === 'parallel') {
              blockIcon = SplitIcon
            }

            return (
              <div key={blockName}>
                <div className='flex items-center gap-1.5 px-[6px] py-[4px]'>
                  <TagIcon icon={blockIcon} color={blockColor} />
                  <span className='font-medium text-[13px]'>{blockName}</span>
                </div>

                <div className='flex flex-col gap-[2px]'>
                  {outputs.map((output, localIndex) => {
                    const globalIndex = startIndex + localIndex
                    const isHighlighted = globalIndex === highlightedIndex

                    return (
                      <PopoverItem
                        key={output.id}
                        active={isSelectedValue(output) || isHighlighted}
                        data-option-index={globalIndex}
                        onClick={() => handleOutputSelection(output.label)}
                        onMouseEnter={() => setHighlightedIndex(globalIndex)}
                      >
                        <span className='min-w-0 flex-1 truncate'>{output.path}</span>
                        {isSelectedValue(output) && <Check className='h-3 w-3 flex-shrink-0' />}
                      </PopoverItem>
                    )
                  })}
                </div>
                {groupIndex < groupArray.length - 1 && <PopoverDivider />}
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
