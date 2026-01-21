'use client'

import type React from 'react'
import { useMemo } from 'react'
import { RepeatIcon, SplitIcon } from 'lucide-react'
import { Combobox, type ComboboxOptionGroup } from '@/components/emcn'
import {
  extractFieldsFromSchema,
  parseResponseFormatSafely,
} from '@/lib/core/utils/response-format'
import { getToolOutputs } from '@/lib/workflows/blocks/block-outputs'
import { getBlock } from '@/blocks'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Renders a tag icon with background color for block section headers.
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
  /** Alignment of the dropdown relative to the trigger */
  align?: 'start' | 'end' | 'center'
  /** Maximum height of the dropdown content in pixels */
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
  align = 'start',
  maxHeight = 200,
}: OutputSelectProps) {
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
        // Build subBlocks object for tool selector
        const rawSubBlockValues =
          shouldUseBaseline && baselineWorkflow
            ? baselineWorkflow.blocks?.[block.id]?.subBlocks
            : subBlockValues?.[block.id]
        const subBlocks: Record<string, { value: unknown }> = {}
        if (rawSubBlockValues && typeof rawSubBlockValues === 'object') {
          for (const [key, val] of Object.entries(rawSubBlockValues)) {
            // Handle both { value: ... } and raw value formats
            subBlocks[key] = val && typeof val === 'object' && 'value' in val ? val : { value: val }
          }
        }

        const toolOutputs = blockConfig ? getToolOutputs(blockConfig, subBlocks) : {}
        outputsToProcess =
          Object.keys(toolOutputs).length > 0 ? toolOutputs : blockConfig?.outputs || {}
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
   * Gets display text for selected outputs
   */
  const selectedDisplayText = useMemo(() => {
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
      return '1 output'
    }

    return `${validOutputs.length} outputs`
  }, [selectedOutputs, workflowOutputs, placeholder])

  /**
   * Gets the background color for a block output based on its type
   * @param blockType - The type of the block
   * @returns The hex color code for the block
   */
  const getOutputColor = (blockType: string) => {
    const blockConfig = getBlock(blockType)
    return blockConfig?.bgColor || '#2F55FF'
  }

  /**
   * Groups outputs by block and sorts by distance from starter block.
   * Returns ComboboxOptionGroup[] for use with Combobox.
   */
  const comboboxGroups = useMemo((): ComboboxOptionGroup[] => {
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

    const sortedGroups = Object.entries(groups)
      .map(([blockName, outputs]) => ({
        blockName,
        outputs,
        distance: blockDistances[outputs[0]?.blockId] || 0,
      }))
      .sort((a, b) => b.distance - a.distance)

    return sortedGroups.map(({ blockName, outputs }) => {
      const firstOutput = outputs[0]
      const blockConfig = getBlock(firstOutput.blockType)
      const blockColor = getOutputColor(firstOutput.blockType)

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

      return {
        sectionElement: (
          <div className='flex items-center gap-1.5 px-[6px] py-[4px]'>
            <TagIcon icon={blockIcon} color={blockColor} />
            <span className='font-medium text-[13px]'>{blockName}</span>
          </div>
        ),
        items: outputs.map((output) => ({
          label: output.path,
          value: valueMode === 'label' ? output.label : output.id,
        })),
      }
    })
  }, [workflowOutputs, blocks, valueMode])

  /**
   * Normalize selected values to match the valueMode
   */
  const normalizedSelectedValues = useMemo(() => {
    return selectedOutputs
      .map((val) => {
        // Find the output that matches either id or label
        const output = workflowOutputs.find((o) => o.id === val || o.label === val)
        if (!output) return null
        // Return in the format matching valueMode
        return valueMode === 'label' ? output.label : output.id
      })
      .filter((v): v is string => v !== null)
  }, [selectedOutputs, workflowOutputs, valueMode])

  return (
    <Combobox
      size='sm'
      className='!w-fit !py-[2px] min-w-[100px] rounded-[6px] px-[9px]'
      groups={comboboxGroups}
      options={[]}
      multiSelect
      multiSelectValues={normalizedSelectedValues}
      onMultiSelectChange={onOutputSelect}
      placeholder={selectedDisplayText}
      overlayContent={
        <span className='truncate text-[var(--text-primary)]'>{selectedDisplayText}</span>
      }
      disabled={disabled || workflowOutputs.length === 0}
      align={align}
      maxHeight={maxHeight}
      dropdownWidth={180}
    />
  )
}
