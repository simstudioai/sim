'use client'

import { useMemo } from 'react'
import { ChipCombobox, Combobox, type ComboboxOptionGroup, cn, OverflowText } from '@sim/emcn'
import { useShallow } from 'zustand/react/shallow'
import {
  type FlattenOutputsBlockInput,
  flattenWorkflowOutputs,
} from '@/lib/workflows/blocks/flatten-outputs'
import { BlockTile } from '@/blocks/block-tile'
import { normalizeName } from '@/executor/constants'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const EMPTY_OUTPUTS: string[] = []

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
  /**
   * Trigger chrome. `'sm'` is the compact pill used in inline toolbars;
   * `'md'` is the 30px chip field, for stacking with `ChipInput` in a form.
   * @default 'sm'
   */
  size?: 'sm' | 'md'
  /** Additional class names to apply to the combobox trigger */
  className?: string
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
  selectedOutputs = EMPTY_OUTPUTS,
  onOutputSelect,
  disabled = false,
  placeholder = 'Select outputs',
  valueMode = 'id',
  align = 'start',
  maxHeight = 200,
  size = 'sm',
  className,
}: OutputSelectProps) {
  const blocks = useWorkflowStore((state) => state.blocks)
  const { isShowingDiff, isDiffReady, hasActiveDiff, baselineWorkflow } = useWorkflowDiffStore(
    useShallow((s) => ({
      isShowingDiff: s.isShowingDiff,
      isDiffReady: s.isDiffReady,
      hasActiveDiff: s.hasActiveDiff,
      baselineWorkflow: s.baselineWorkflow,
    }))
  )
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
    if (!workflowId || !workflowBlocks || typeof workflowBlocks !== 'object') {
      return []
    }
    const blockArray = Object.values(workflowBlocks) as any[]
    if (blockArray.length === 0) return []

    // Merge the editor's subblock store values into the blocks before flattening —
    // the workflow store doesn't always have the latest subBlocks.value.
    const mergedBlocks: FlattenOutputsBlockInput[] = blockArray.map((block) => {
      const rawSubBlockValues =
        shouldUseBaseline && baselineWorkflow
          ? baselineWorkflow.blocks?.[block.id]?.subBlocks
          : subBlockValues?.[block.id]
      const subBlocks: Record<string, unknown> = {}
      if (rawSubBlockValues && typeof rawSubBlockValues === 'object') {
        for (const [key, val] of Object.entries(rawSubBlockValues)) {
          subBlocks[key] =
            val && typeof val === 'object' && 'value' in (val as object)
              ? (val as { value: unknown })
              : { value: val }
        }
      }
      return {
        id: block.id,
        type: block.type,
        name: block.name,
        triggerMode: Boolean(block.triggerMode),
        subBlocks,
      }
    })

    const flat = flattenWorkflowOutputs(mergedBlocks)
    return flat.map((f) => {
      const displayBlockName =
        f.blockName && typeof f.blockName === 'string'
          ? normalizeName(f.blockName)
          : `block-${f.blockId}`
      return {
        id: `${f.blockId}_${f.path}`,
        label: `${displayBlockName}.${f.path}`,
        blockId: f.blockId,
        blockName: f.blockName,
        blockType: f.blockType,
        path: f.path,
      }
    })
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

      return {
        sectionElement: (
          <div className='flex items-center gap-1.5 px-1.5 py-1'>
            <BlockTile
              blockType={firstOutput.blockType}
              fallbackLabel={blockName.charAt(0).toUpperCase()}
              size='sm'
            />
            <span className='text-small'>{blockName}</span>
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

  const Trigger = size === 'md' ? ChipCombobox : Combobox

  return (
    <Trigger
      size={size}
      className={cn('min-w-[100px]', size === 'sm' && '!py-0.5 w-fit rounded-md px-2.5', className)}
      groups={comboboxGroups}
      options={[]}
      multiSelect
      multiSelectValues={normalizedSelectedValues}
      onMultiSelectChange={onOutputSelect}
      placeholder={selectedDisplayText}
      overlayContent={
        <OverflowText label={selectedDisplayText} className='text-[var(--text-primary)]' />
      }
      disabled={disabled || workflowOutputs.length === 0}
      align={align}
      maxHeight={maxHeight}
      dropdownWidth={180}
    />
  )
}
