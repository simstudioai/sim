'use client'

import { useMemo, useState } from 'react'
import {
  ChipCombobox,
  Combobox,
  type ComboboxOption,
  type ComboboxOptionGroup,
  cn,
} from '@sim/emcn'
import { ArrowLeft, ChevronRight } from '@sim/emcn/icons'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { useShallow } from 'zustand/react/shallow'
import {
  buildWorkflowOutputMenu,
  buildWorkflowOutputOptions,
  collectReferencedWorkflowIds,
  type WorkflowOutputMenuNode,
  type WorkflowOutputOption,
} from '@/lib/workflows/streaming/nested-output-options'
import { formatPublicOutputSelector } from '@/lib/workflows/streaming/output-selector'
import { BlockTile } from '@/blocks/block-tile'
import { DEFAULTS, normalizeName } from '@/executor/constants'
import { useWorkflowStates } from '@/hooks/queries/workflows'
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
  /** Whether to emit internal IDs, display labels, or public dot selectors */
  valueMode?: 'id' | 'label' | 'public'
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

interface OutputSelectMenuProps {
  outputMenu: readonly WorkflowOutputMenuNode[]
  workflowOutputs: readonly WorkflowOutputOption[]
  selectedOutputs: string[]
  onOutputSelect: (outputIds: string[]) => void
  disabled: boolean
  placeholder: string
  valueMode: 'id' | 'label' | 'public'
  align: 'start' | 'end' | 'center'
  maxHeight: number
  size: 'sm' | 'md'
  className?: string
}

function getOutputValue(
  output: WorkflowOutputOption,
  valueMode: 'id' | 'label' | 'public'
): string {
  if (valueMode === 'public') {
    return formatPublicOutputSelector(
      normalizeName(output.blockName),
      output.path,
      output.workflowId
    )
  }
  return valueMode === 'label' ? output.label : output.id
}

function resolveOutputMenuNode(
  roots: readonly WorkflowOutputMenuNode[],
  menuPath: readonly string[]
): WorkflowOutputMenuNode | undefined {
  let nodes = roots
  let activeNode: WorkflowOutputMenuNode | undefined
  for (const blockId of menuPath) {
    activeNode = nodes.find((node) => node.blockId === blockId)
    if (!activeNode) {
      throw new Error(`Output menu path does not resolve: ${menuPath.join('/')}`)
    }
    nodes = activeNode.children
  }
  return activeNode
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
export function OutputSelect(props: OutputSelectProps) {
  return <OutputSelectContent {...props} />
}

function OutputSelectContent({
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
  const edges = useWorkflowStore((state) => state.edges)
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
  const workflowBlocks = shouldUseBaseline && baselineWorkflow ? baselineWorkflow.blocks : blocks
  const workflowEdges = shouldUseBaseline && baselineWorkflow ? baselineWorkflow.edges : edges

  const rootState = useMemo<Pick<WorkflowState, 'blocks' | 'edges'>>(() => {
    if (!workflowId || !workflowBlocks || typeof workflowBlocks !== 'object') {
      return { blocks: {}, edges: [] }
    }
    const blockArray = Object.values(workflowBlocks) as BlockState[]

    const mergedBlocks = blockArray.map((block): BlockState => {
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
        ...block,
        subBlocks,
      } as BlockState
    })

    return {
      blocks: Object.fromEntries(mergedBlocks.map((block) => [block.id, block])),
      edges: workflowEdges,
    }
  }, [
    workflowBlocks,
    workflowEdges,
    workflowId,
    baselineWorkflow,
    subBlockValues,
    shouldUseBaseline,
  ])

  const firstLevelWorkflowIds = useMemo(
    () => collectReferencedWorkflowIds([rootState]),
    [rootState]
  )
  const firstLevelStates = useWorkflowStates(firstLevelWorkflowIds)
  const secondLevelWorkflowIds = collectReferencedWorkflowIds(firstLevelStates.values())
  const secondLevelStates = useWorkflowStates(secondLevelWorkflowIds)
  const thirdLevelWorkflowIds = collectReferencedWorkflowIds(secondLevelStates.values())
  const thirdLevelStates = useWorkflowStates(thirdLevelWorkflowIds)

  const workflowStates = new Map([...firstLevelStates, ...secondLevelStates, ...thirdLevelStates])
  const workflowOutputs = workflowId
    ? buildWorkflowOutputOptions({
        rootWorkflowId: workflowId,
        rootState,
        workflowStates,
        maxChildDepth: DEFAULTS.MAX_SSE_CHILD_DEPTH,
      })
    : []
  const outputMenu = buildWorkflowOutputMenu(workflowOutputs)
  const outputMenuRevision = JSON.stringify([
    workflowId,
    ...workflowOutputs.map((output) => [
      output.id,
      ...output.menuPath.map((segment) => segment.blockId),
    ]),
  ])

  return (
    <OutputSelectMenu
      key={outputMenuRevision}
      outputMenu={outputMenu}
      workflowOutputs={workflowOutputs}
      selectedOutputs={selectedOutputs}
      onOutputSelect={onOutputSelect}
      disabled={disabled}
      placeholder={placeholder}
      valueMode={valueMode}
      align={align}
      maxHeight={maxHeight}
      size={size}
      className={className}
    />
  )
}

function OutputSelectMenu({
  outputMenu,
  workflowOutputs,
  selectedOutputs,
  onOutputSelect,
  disabled,
  placeholder,
  valueMode,
  align,
  maxHeight,
  size,
  className,
}: OutputSelectMenuProps) {
  const [menuPath, setMenuPath] = useState<string[]>([])
  const activeMenuNode = resolveOutputMenuNode(outputMenu, menuPath)

  const validOutputCount = selectedOutputs.filter((val) =>
    workflowOutputs.some((output) => output.id === val || output.label === val)
  ).length
  let selectedDisplayText = placeholder
  if (validOutputCount === 1) {
    selectedDisplayText = '1 output'
  } else if (validOutputCount > 1) {
    selectedDisplayText = `${validOutputCount} outputs`
  }

  const normalizedSelectedValues = selectedOutputs
    .map((val) => {
      const output = workflowOutputs.find((item) => item.id === val || item.label === val)
      if (!output) return null
      return getOutputValue(output, valueMode)
    })
    .filter((value): value is string => value !== null)

  const folderOption = (node: WorkflowOutputMenuNode): ComboboxOption => ({
    label: 'Outputs',
    value: `folder:${node.blockId}`,
    suffixElement: <ChevronRight className='size-[12px] text-[var(--text-tertiary)]' />,
    onSelect: () => setMenuPath((currentPath) => [...currentPath, node.blockId]),
    keepOpen: true,
  })

  const outputGroup = (node: WorkflowOutputMenuNode): ComboboxOptionGroup => ({
    sectionElement: (
      <div className='flex items-center gap-1.5 px-1.5 py-1'>
        <BlockTile
          blockType={node.blockType}
          fallbackLabel={node.blockName.charAt(0).toUpperCase()}
          size='sm'
        />
        <span className='text-small'>{node.blockName}</span>
      </div>
    ),
    items: [
      ...node.outputs.map((output) => ({
        label: output.path,
        value: getOutputValue(output, valueMode),
      })),
      ...(node.children.length > 0 ? [folderOption(node)] : []),
    ],
  })

  const comboboxGroups: ComboboxOptionGroup[] = activeMenuNode
    ? [
        {
          section: activeMenuNode.blockName,
          items: [
            {
              label: 'Back',
              value: `back:${activeMenuNode.blockId}`,
              iconElement: <ArrowLeft className='size-[14px] text-[var(--text-tertiary)]' />,
              onSelect: () => setMenuPath((currentPath) => currentPath.slice(0, -1)),
              keepOpen: true,
            },
          ],
        },
        ...activeMenuNode.children.map(outputGroup),
      ]
    : outputMenu.map(outputGroup)
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
      onOpenChange={(open) => {
        if (!open) setMenuPath([])
      }}
      onArrowLeft={
        activeMenuNode ? () => setMenuPath((currentPath) => currentPath.slice(0, -1)) : undefined
      }
      placeholder={selectedDisplayText}
      overlayLabel={selectedDisplayText}
      overlayContent={selectedDisplayText}
      disabled={disabled || workflowOutputs.length === 0}
      align={align}
      maxHeight={maxHeight}
      dropdownWidth={180}
    />
  )
}
