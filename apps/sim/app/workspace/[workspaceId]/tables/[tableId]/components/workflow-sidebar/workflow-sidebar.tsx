'use client'

import type React from 'react'
import { useMemo, useState } from 'react'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RepeatIcon, SplitIcon, X } from 'lucide-react'
import {
  Button,
  Combobox,
  type ComboboxOptionGroup,
  FieldDivider,
  Input,
  Label,
  Loader,
  Switch,
  Tooltip,
  toast,
} from '@/components/emcn'
import { findValidationIssue, isValidationError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type {
  AddWorkflowGroupBodyInput,
  UpdateWorkflowGroupBodyInput,
} from '@/lib/api/contracts/tables'
import {
  putWorkflowNormalizedStateContract,
  type WorkflowStateContractInput,
} from '@/lib/api/contracts/workflows'
import { cn } from '@/lib/core/utils/cn'
import type {
  ColumnDefinition,
  WorkflowGroup,
  WorkflowGroupDependencies,
  WorkflowGroupOutput,
} from '@/lib/table'
import { columnTypeForLeaf, deriveOutputColumnName } from '@/lib/table/column-naming'
import {
  type FlattenOutputsBlockInput,
  type FlattenOutputsEdgeInput,
  flattenWorkflowOutputs,
  getBlockExecutionOrder,
} from '@/lib/workflows/blocks/flatten-outputs'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import { PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview'
import { getBlock } from '@/blocks'
import {
  useAddWorkflowGroup,
  useUpdateColumn,
  useUpdateWorkflowGroup,
} from '@/hooks/queries/tables'
import { useWorkflowState, workflowKeys } from '@/hooks/queries/workflows'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { RunSettingsSection } from './run-settings-section'

/**
 * Discriminates the three flows the workflow sidebar handles:
 * - `create`: brand-new workflow group spawned from the "+ New column" dropdown's "Workflow" item.
 * - `edit-group`: opened from the workflow-group meta header. Lets the user edit the whole group
 *   (workflow id, deps, output set, group name).
 * - `edit-output`: opened from a single workflow-output column header. Focuses on this column's
 *   `(blockId, path)` mapping + column rename. Other group-wide controls remain visible but
 *   secondary.
 */
export type WorkflowConfig =
  | { mode: 'create'; proposedName: string }
  | { mode: 'edit-group'; groupId: string }
  | { mode: 'edit-output'; columnName: string }

interface WorkflowSidebarProps {
  config: WorkflowConfig | null
  onClose: () => void
  /** All scalar + workflow-output columns on the table. Drives the deps picker
   *  options and the "missing inputs" prompt. */
  allColumns: ColumnDefinition[]
  workflowGroups: WorkflowGroup[]
  workflows: WorkflowMetadata[] | undefined
  workspaceId: string
  tableId: string
  /** Notify parent of a per-output-column rename so it can rewrite local
   *  `columnOrder` / `columnWidths` keys. */
  onColumnRename?: (oldName: string, newName: string) => void
}

const OUTPUT_VALUE_SEPARATOR = '::'

const encodeOutputValue = (blockId: string, path: string) =>
  `${blockId}${OUTPUT_VALUE_SEPARATOR}${path}`

const decodeOutputValue = (value: string): { blockId: string; path: string } => {
  const idx = value.indexOf(OUTPUT_VALUE_SEPARATOR)
  if (idx === -1) return { blockId: '', path: value }
  return { blockId: value.slice(0, idx), path: value.slice(idx + OUTPUT_VALUE_SEPARATOR.length) }
}

interface BlockOutputGroup {
  blockId: string
  blockName: string
  blockType: string
  blockIcon: string | React.ComponentType<{ className?: string }>
  blockColor: string
  paths: string[]
}

interface WorkflowStatePayload {
  blocks: Record<
    string,
    {
      type: string
      subBlocks?: Record<string, { id?: string; type?: string; value?: unknown }>
    } & Record<string, unknown>
  >
  edges: unknown[]
  loops: unknown
  parallels: unknown
  lastSaved?: number
  isDeployed?: boolean
}

function tableColumnTypeToInputType(colType: ColumnDefinition['type'] | undefined): string {
  switch (colType) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'json':
      return 'object'
    default:
      return 'string'
  }
}

function RequiredLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className='flex items-baseline gap-1.5 whitespace-nowrap pl-0.5'>
      {children}
      <span className='ml-0.5'>*</span>
    </Label>
  )
}

function FieldError({ message }: { message: string }) {
  return <p className='pl-0.5 text-caption text-destructive'>{message}</p>
}

const TagIcon: React.FC<{
  icon: string | React.ComponentType<{ className?: string }>
  color: string
}> = ({ icon, color }) => (
  <div
    className='flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded'
    style={{ background: color }}
  >
    {typeof icon === 'string' ? (
      <span className='!text-white font-bold text-micro'>{icon}</span>
    ) : (
      (() => {
        const IconComponent = icon
        return <IconComponent className='!text-white size-[9px]' />
      })()
    )}
  </div>
)

/**
 * Right-edge sidebar for workflow group configuration. Three flows:
 * - create a new group (workflow + outputs + deps),
 * - edit an existing group (same fields, plus rename output-column option),
 * - edit a single output column's mapping (swap which `(blockId, path)` it
 *   reads from, rename the column).
 *
 * All form state lives in `<WorkflowSidebarBody>`, which the outer shell
 * mounts with `key={configKey(config)}` so opening a different group/column
 * remounts and re-seeds state from props (no `useEffect` mirror).
 */
export function WorkflowSidebar(props: WorkflowSidebarProps) {
  const open = props.config !== null
  return (
    <aside
      role='dialog'
      aria-label='Configure workflow'
      className={cn(
        'absolute top-0 right-0 bottom-0 z-[var(--z-modal)] flex w-[400px] flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--bg)] shadow-overlay transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {props.config && (
        <WorkflowSidebarBody key={configKey(props.config)} {...props} config={props.config} />
      )}
    </aside>
  )
}

function configKey(config: WorkflowConfig): string {
  switch (config.mode) {
    case 'create':
      return `create:${config.proposedName}`
    case 'edit-group':
      return `edit-group:${config.groupId}`
    case 'edit-output':
      return `edit-output:${config.columnName}`
  }
}

interface WorkflowSidebarBodyProps extends Omit<WorkflowSidebarProps, 'config'> {
  config: WorkflowConfig
}

function WorkflowSidebarBody({
  config,
  onClose,
  allColumns,
  workflowGroups,
  workflows,
  workspaceId,
  tableId,
  onColumnRename,
}: WorkflowSidebarBodyProps) {
  const updateColumn = useUpdateColumn({ workspaceId, tableId })
  const addWorkflowGroup = useAddWorkflowGroup({ workspaceId, tableId })
  const updateWorkflowGroup = useUpdateWorkflowGroup({ workspaceId, tableId })

  // Resolve the existing group (if any) and the existing single-output column
  // (if `mode === 'edit-output'`) from props. These are derivations — used
  // only for seeding the form below and for save-time diffs.
  const existingGroup: WorkflowGroup | undefined = (() => {
    if (config.mode === 'edit-group') return workflowGroups.find((g) => g.id === config.groupId)
    if (config.mode === 'edit-output') {
      const col = allColumns.find((c) => c.name === config.columnName)
      return col?.workflowGroupId
        ? workflowGroups.find((g) => g.id === col.workflowGroupId)
        : undefined
    }
    return undefined
  })()
  const existingColumn =
    config.mode === 'edit-output'
      ? (allColumns.find((c) => c.name === config.columnName) ?? null)
      : null

  // Anchor column for "left of current" filtering. For create + edit-group we
  // treat the anchor as missing (group config sits at the right edge of the
  // group); for edit-output the anchor is the column being edited.
  const anchorColumnName = config.mode === 'edit-output' ? config.columnName : null

  /**
   * Columns "left of current" — these are the only valid trigger dependencies.
   * For create + edit-group, every existing column qualifies. For edit-output,
   * only columns physically before the anchor.
   */
  const otherColumns = (() => {
    if (anchorColumnName === null) return allColumns
    const idx = allColumns.findIndex((c) => c.name === anchorColumnName)
    if (idx === -1) return allColumns.filter((c) => c.name !== anchorColumnName)
    return allColumns.slice(0, idx)
  })()

  // Every left-of-current column is a valid dep — workflow output columns
  // included. Exclude this group's own outputs (you can't depend on yourself).
  const ownOutputNames = new Set(existingGroup?.outputs.map((o) => o.columnName) ?? [])
  const depOptions = otherColumns.filter((c) => !ownOutputNames.has(c.name))

  // Default deps for a brand-new group: tick every left-of-current column.
  const defaultDeps = depOptions.map((c) => c.name)

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    () => existingGroup?.workflowId ?? ''
  )
  // For existing groups, treat a missing `autoRun` field as `true` (pre-feature
  // groups all ran automatically and shouldn't silently flip to manual when
  // the user just opens the sidebar). For brand-new groups, default to `false`
  // so the user opts in to auto-run explicitly.
  const [autoRun, setAutoRun] = useState<boolean>(() =>
    existingGroup ? existingGroup.autoRun !== false : false
  )
  const [deps, setDeps] = useState<string[]>(
    () => existingGroup?.dependencies?.columns ?? defaultDeps
  )
  // `selectedOutputs` is encoded `${blockId}::${path}`. Seeded once `blockOutputGroups`
  // resolves (we may not have the workflow blocks loaded at first render); see the
  // post-load reconciliation below.
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([])
  const [outputsHydrated, setOutputsHydrated] = useState(false)
  const [columnNameInput, setColumnNameInput] = useState<string>(
    () => existingColumn?.name ?? (config.mode === 'create' ? config.proposedName : '')
  )
  const [showValidation, setShowValidation] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const workflowState = useWorkflowState(selectedWorkflowId || undefined)

  /** Resolves the unified Start block id and its current `inputFormat` field
   *  names. The "Add inputs" mutation only adds rows for table columns that
   *  aren't already represented in the start block. */
  const startBlockInputs = useMemo<{
    blockId: string | null
    existingNames: Set<string>
    existing: InputFormatField[]
  }>(() => {
    const blocks = (workflowState.data as { blocks?: Record<string, { type: string }> } | null)
      ?.blocks
    if (!blocks) return { blockId: null, existingNames: new Set(), existing: [] }
    const candidate = TriggerUtils.findStartBlock(blocks, 'manual')
    if (!candidate) return { blockId: null, existingNames: new Set(), existing: [] }
    const block = blocks[candidate.blockId] as
      | { subBlocks?: Record<string, { value?: unknown }> }
      | undefined
    const existing = normalizeInputFormatValue(block?.subBlocks?.inputFormat?.value)
    return {
      blockId: candidate.blockId,
      existingNames: new Set(existing.map((f) => f.name).filter((n): n is string => !!n)),
      existing,
    }
  }, [workflowState.data])

  const missingInputColumnNames = useMemo<string[]>(() => {
    if (!startBlockInputs.blockId) return []
    const anchor = anchorColumnName
    return allColumns
      .filter(
        (c) =>
          c.name !== anchor && !c.workflowGroupId && !startBlockInputs.existingNames.has(c.name)
      )
      .map((c) => c.name)
  }, [allColumns, anchorColumnName, startBlockInputs])

  const queryClient = useQueryClient()
  const addInputsMutation = useMutation({
    mutationFn: async () => {
      const wfId = selectedWorkflowId
      const startBlockId = startBlockInputs.blockId
      const state = workflowState.data as WorkflowStatePayload | null | undefined
      if (!wfId || !startBlockId || !state || missingInputColumnNames.length === 0) {
        throw new Error('Nothing to add')
      }
      const startBlock = state.blocks[startBlockId]
      if (!startBlock) throw new Error('Start block missing from workflow')

      const newFields: InputFormatField[] = missingInputColumnNames.map((name) => {
        const col = allColumns.find((c) => c.name === name)
        return {
          id: generateId(),
          name,
          type: tableColumnTypeToInputType(col?.type),
          value: '',
          collapsed: false,
        } as InputFormatField & { id: string; collapsed: boolean }
      })

      const updatedSubBlock = {
        ...(startBlock.subBlocks?.inputFormat ?? { id: 'inputFormat', type: 'input-format' }),
        value: [...startBlockInputs.existing, ...newFields],
      }
      const updatedBlocks = {
        ...state.blocks,
        [startBlockId]: {
          ...startBlock,
          subBlocks: { ...startBlock.subBlocks, inputFormat: updatedSubBlock },
        },
      }

      const rawBody = {
        blocks: updatedBlocks,
        edges: state.edges,
        loops: state.loops,
        parallels: state.parallels,
        lastSaved: state.lastSaved ?? Date.now(),
        isDeployed: state.isDeployed ?? false,
      }
      // double-cast-allowed: WorkflowStatePayload is the loose local view of
      // useWorkflowState; round-trip back to the strict PUT body shape.
      const body = rawBody as unknown as WorkflowStateContractInput
      await requestJson(putWorkflowNormalizedStateContract, { params: { id: wfId }, body })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.state(selectedWorkflowId) })
    },
    onError: (err) => {
      toast.error(toError(err).message)
    },
  })

  const blockOutputGroups = useMemo<BlockOutputGroup[]>(() => {
    const state = workflowState.data as
      | {
          blocks?: Record<string, FlattenOutputsBlockInput>
          edges?: FlattenOutputsEdgeInput[]
        }
      | null
      | undefined
    if (!state?.blocks) return []

    const blocks = Object.values(state.blocks)
    const edges = state.edges ?? []
    const flat = flattenWorkflowOutputs(blocks, edges)
    if (flat.length === 0) return []

    const groupsByBlockId = new Map<string, BlockOutputGroup>()
    for (const f of flat) {
      let group = groupsByBlockId.get(f.blockId)
      if (!group) {
        const blockConfig = getBlock(f.blockType)
        const blockColor = blockConfig?.bgColor || '#2F55FF'
        let blockIcon: string | React.ComponentType<{ className?: string }> = f.blockName
          .charAt(0)
          .toUpperCase()
        if (blockConfig?.icon) blockIcon = blockConfig.icon
        else if (f.blockType === 'loop') blockIcon = RepeatIcon
        else if (f.blockType === 'parallel') blockIcon = SplitIcon
        group = {
          blockId: f.blockId,
          blockName: f.blockName,
          blockType: f.blockType,
          blockIcon,
          blockColor,
          paths: [],
        }
        groupsByBlockId.set(f.blockId, group)
      }
      group.paths.push(f.path)
    }
    const distances = getBlockExecutionOrder(blocks, edges)
    return Array.from(groupsByBlockId.values()).sort((a, b) => {
      const da = distances[a.blockId]
      const db = distances[b.blockId]
      const sa = da === undefined || da < 0 ? Number.POSITIVE_INFINITY : da
      const sb = db === undefined || db < 0 ? Number.POSITIVE_INFINITY : db
      return sa - sb
    })
  }, [workflowState.data])

  const outputGroupOptions = useMemo<ComboboxOptionGroup[]>(
    () =>
      blockOutputGroups.map((group) => ({
        section: group.blockName,
        sectionElement: (
          <div className='flex items-center gap-1.5 px-1.5 pt-1.5 pb-1'>
            <TagIcon icon={group.blockIcon} color={group.blockColor} />
            <span className='font-medium text-[var(--text-secondary)] text-caption'>
              {group.blockName}
            </span>
          </div>
        ),
        items: group.paths.map((path) => ({
          label: path,
          value: encodeOutputValue(group.blockId, path),
        })),
      })),
    [blockOutputGroups]
  )

  // Once the workflow's blocks are loaded, re-encode persisted `{blockId, path}`
  // entries into the picker's encoded form. Stale entries (block deleted or
  // path removed) are dropped silently — the user can re-pick on save.
  if (!outputsHydrated && existingGroup?.outputs.length && blockOutputGroups.length > 0) {
    const encoded: string[] = []
    if (config.mode === 'edit-output' && existingColumn) {
      // Single-output sub-mode: only seed the picker with this column's mapping.
      const own = existingGroup.outputs.find((o) => o.columnName === existingColumn.name)
      if (own) {
        const match = blockOutputGroups.find(
          (g) => g.blockId === own.blockId && g.paths.includes(own.path)
        )
        if (match) encoded.push(encodeOutputValue(own.blockId, own.path))
      }
    } else {
      for (const entry of existingGroup.outputs) {
        const match = blockOutputGroups.find(
          (g) => g.blockId === entry.blockId && g.paths.includes(entry.path)
        )
        if (match) encoded.push(encodeOutputValue(entry.blockId, entry.path))
      }
    }
    setSelectedOutputs(encoded)
    setOutputsHydrated(true)
  }

  /**
   * Builds the ordered, deduplicated `(blockId, path)` list from the picker
   * state, sorted by execution order.
   */
  function buildOrderedPickedOutputs(): Array<{
    blockId: string
    path: string
    leafType?: string
  }> {
    const seen = new Set<string>()
    const outputs: Array<{ blockId: string; path: string; leafType?: string }> = []
    for (const encoded of selectedOutputs) {
      if (seen.has(encoded)) continue
      seen.add(encoded)
      outputs.push(decodeOutputValue(encoded))
    }
    const wfState = workflowState.data as
      | {
          blocks?: Record<string, FlattenOutputsBlockInput>
          edges?: FlattenOutputsEdgeInput[]
        }
      | null
      | undefined
    if (wfState?.blocks) {
      const blocks = Object.values(wfState.blocks)
      const edges = wfState.edges ?? []
      const distances = getBlockExecutionOrder(blocks, edges)
      const flat = flattenWorkflowOutputs(blocks, edges)
      const indexInFlat = new Map(
        flat.map((f, i) => [`${f.blockId}${OUTPUT_VALUE_SEPARATOR}${f.path}`, i])
      )
      const leafTypeByKey = new Map(
        flat.map((f) => [`${f.blockId}${OUTPUT_VALUE_SEPARATOR}${f.path}`, f.leafType])
      )
      for (const o of outputs) {
        o.leafType = leafTypeByKey.get(`${o.blockId}${OUTPUT_VALUE_SEPARATOR}${o.path}`)
      }
      outputs.sort((a, b) => {
        const da = distances[a.blockId]
        const db = distances[b.blockId]
        const sa = da === undefined || da < 0 ? Number.POSITIVE_INFINITY : da
        const sb = db === undefined || db < 0 ? Number.POSITIVE_INFINITY : db
        if (sa !== sb) return sa - sb
        const ia =
          indexInFlat.get(`${a.blockId}${OUTPUT_VALUE_SEPARATOR}${a.path}`) ??
          Number.POSITIVE_INFINITY
        const ib =
          indexInFlat.get(`${b.blockId}${OUTPUT_VALUE_SEPARATOR}${b.path}`) ??
          Number.POSITIVE_INFINITY
        return ia - ib
      })
    }
    return outputs
  }

  const isEditOutputMode = config.mode === 'edit-output'

  async function handleSave() {
    const trimmedName = columnNameInput.trim()

    const missing: string[] = []
    if (!selectedWorkflowId) missing.push('a workflow')
    if (selectedWorkflowId && selectedOutputs.length === 0) missing.push('at least one output')
    if (isEditOutputMode && !trimmedName) missing.push('a column name')
    if (missing.length > 0) {
      setShowValidation(true)
      return
    }

    try {
      const orderedOutputs = buildOrderedPickedOutputs()
      const dependencies: WorkflowGroupDependencies = { columns: deps }

      if (existingGroup) {
        // edit-output: swap one column's source mapping (and optionally rename
        // the column itself). edit-group: full add/remove diff against the
        // group's existing outputs.
        if (isEditOutputMode && existingColumn) {
          const renamedColumn =
            trimmedName !== existingColumn.name
              ? { from: existingColumn.name, to: trimmedName }
              : null
          const newPick = orderedOutputs[0]
          if (!newPick) throw new Error('Pick an output')
          if (renamedColumn) {
            await updateColumn.mutateAsync({
              columnName: renamedColumn.from,
              updates: { name: renamedColumn.to },
            })
            onColumnRename?.(renamedColumn.from, renamedColumn.to)
          }
          // Reference the post-rename column name in mappingUpdates. The
          // server applies the mapping swap and clears the column's row data
          // so the next workflow run repopulates from the new source.
          const targetColumnName = renamedColumn?.to ?? existingColumn.name
          await updateWorkflowGroup.mutateAsync({
            groupId: existingGroup.id,
            workflowId: selectedWorkflowId,
            name: existingGroup.name,
            dependencies,
            mappingUpdates: [
              { columnName: targetColumnName, blockId: newPick.blockId, path: newPick.path },
            ],
          })
          toast.success(`Saved "${targetColumnName}"`)
        } else {
          // edit-group: full output diff with new-column derivation.
          const taken = new Set(allColumns.map((c) => c.name))
          const fullOutputs: WorkflowGroupOutput[] = []
          const newOutputColumns: NonNullable<UpdateWorkflowGroupBodyInput['newOutputColumns']> = []
          for (const o of orderedOutputs) {
            const existingOut = existingGroup.outputs.find(
              (e) => e.blockId === o.blockId && e.path === o.path
            )
            if (existingOut) {
              fullOutputs.push(existingOut)
            } else {
              const colName = deriveOutputColumnName(o.path, taken)
              taken.add(colName)
              fullOutputs.push({ blockId: o.blockId, path: o.path, columnName: colName })
              newOutputColumns.push({
                name: colName,
                type: columnTypeForLeaf(o.leafType),
                required: false,
                unique: false,
                workflowGroupId: existingGroup.id,
              })
            }
          }
          await updateWorkflowGroup.mutateAsync({
            groupId: existingGroup.id,
            workflowId: selectedWorkflowId,
            name: existingGroup.name,
            dependencies,
            outputs: fullOutputs,
            ...(newOutputColumns.length > 0 ? { newOutputColumns } : {}),
            autoRun,
          })
          toast.success(`Saved "${existingGroup.name ?? 'Workflow'}"`)
        }
      } else {
        // Create path: brand-new group with auto-derived output column names.
        const groupId = generateId()
        const taken = new Set(allColumns.map((c) => c.name))
        const newOutputColumns: AddWorkflowGroupBodyInput['outputColumns'] = []
        const groupOutputs: WorkflowGroupOutput[] = []
        for (const o of orderedOutputs) {
          const colName = deriveOutputColumnName(o.path, taken)
          taken.add(colName)
          newOutputColumns.push({
            name: colName,
            type: columnTypeForLeaf(o.leafType),
            required: false,
            unique: false,
            workflowGroupId: groupId,
          })
          groupOutputs.push({ blockId: o.blockId, path: o.path, columnName: colName })
        }
        const workflowName = workflows?.find((w) => w.id === selectedWorkflowId)?.name ?? 'Workflow'
        const group: WorkflowGroup = {
          id: groupId,
          workflowId: selectedWorkflowId,
          name: workflowName,
          dependencies,
          outputs: groupOutputs,
          autoRun,
        }
        await addWorkflowGroup.mutateAsync({ group, outputColumns: newOutputColumns })
        toast.success(`Added "${workflowName}"`)
      }
      onClose()
    } catch (err) {
      if (isValidationError(err)) {
        const nameIssue =
          findValidationIssue(err, ['updates', 'name']) ??
          findValidationIssue(err, ['name']) ??
          findValidationIssue(err, ['columnName'])
        if (nameIssue) {
          setNameError(nameIssue.message)
          return
        }
        toast.error(toError(err).message)
      }
    }
  }

  const saveDisabled =
    addWorkflowGroup.isPending || updateWorkflowGroup.isPending || updateColumn.isPending
  const titleByMode = {
    create: 'Add workflow',
    'edit-group': 'Configure workflow',
    'edit-output': 'Configure output column',
  } as const

  // edit-output mode is single-select on the output picker; everywhere else
  // is multi-select. Same Combobox shape, different mode.
  const outputPickerSingleSelect = isEditOutputMode

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
        <h2 className='font-medium text-[var(--text-primary)] text-small'>
          {titleByMode[config.mode]}
        </h2>
        <Button
          variant='ghost'
          size='sm'
          onClick={onClose}
          className='!p-1 h-7 w-7'
          aria-label='Close'
        >
          <X className='h-[14px] w-[14px]' />
        </Button>
      </div>

      <div className='flex-1 overflow-y-auto overflow-x-hidden px-2 pt-3 pb-2 [overflow-anchor:none]'>
        {/* Single-output mode renames this column directly. */}
        {isEditOutputMode && (
          <>
            <div className='flex flex-col gap-[9.5px]'>
              <RequiredLabel htmlFor='workflow-sidebar-column-name'>Column name</RequiredLabel>
              <Input
                id='workflow-sidebar-column-name'
                value={columnNameInput}
                onChange={(e) => {
                  setColumnNameInput(e.target.value)
                  if (nameError) setNameError(null)
                }}
                spellCheck={false}
                autoComplete='off'
                aria-invalid={
                  (showValidation && !columnNameInput.trim()) || nameError ? true : undefined
                }
              />
              {showValidation && !columnNameInput.trim() && (
                <FieldError message='Column name is required' />
              )}
              {nameError && !(showValidation && !columnNameInput.trim()) && (
                <FieldError message={nameError} />
              )}
            </div>
            <FieldDivider />
          </>
        )}

        {selectedWorkflowId && (
          <>
            <div className='flex flex-col gap-[9.5px]'>
              <div className='flex min-w-0 items-center justify-between gap-2 pl-0.5'>
                <Label>Workflow preview</Label>
                {startBlockInputs.blockId && missingInputColumnNames.length > 0 && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        type='button'
                        variant='default'
                        size='sm'
                        className='flex-none whitespace-nowrap'
                        onClick={() => addInputsMutation.mutate()}
                        disabled={addInputsMutation.isPending}
                      >
                        {addInputsMutation.isPending
                          ? 'Adding…'
                          : `Add inputs (${missingInputColumnNames.length})`}
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>
                      Adds {missingInputColumnNames.join(', ')} to the workflow's Start block
                    </Tooltip.Content>
                  </Tooltip.Root>
                )}
              </div>
              <div className='relative h-[160px] overflow-hidden rounded-sm border border-[var(--border)]'>
                {workflowState.isLoading ? (
                  <div className='flex h-full items-center justify-center bg-[var(--surface-3)]'>
                    <Loader className='h-5 w-5 animate-spin text-[var(--text-tertiary)]' />
                  </div>
                ) : workflowState.data ? (
                  <>
                    <div className='[&_*:active]:!cursor-grabbing [&_*]:!cursor-grab [&_.react-flow__handle]:!hidden h-full w-full'>
                      <PreviewWorkflow
                        workflowState={workflowState.data}
                        height={160}
                        width='100%'
                        isPannable={true}
                        defaultZoom={0.6}
                        fitPadding={0.15}
                        cursorStyle='grab'
                        lightweight
                      />
                    </div>
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          type='button'
                          variant='ghost'
                          onClick={() =>
                            window.open(
                              `/workspace/${workspaceId}/w/${selectedWorkflowId}`,
                              '_blank',
                              'noopener,noreferrer'
                            )
                          }
                          className='absolute right-[6px] bottom-1.5 z-10 h-[24px] w-[24px] cursor-pointer border border-[var(--border)] bg-[var(--surface-2)] p-0 hover-hover:bg-[var(--surface-4)]'
                        >
                          <ExternalLink className='h-[12px] w-[12px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='top'>Open workflow</Tooltip.Content>
                    </Tooltip.Root>
                  </>
                ) : (
                  <div className='flex h-full items-center justify-center bg-[var(--surface-3)]'>
                    <span className='text-[var(--text-tertiary)] text-small'>
                      Unable to load preview
                    </span>
                  </div>
                )}
              </div>
            </div>
            <FieldDivider />
          </>
        )}

        <div className='flex flex-col gap-[9.5px]'>
          <RequiredLabel>Workflow</RequiredLabel>
          <Combobox
            options={workflows?.map((wf) => ({ label: wf.name, value: wf.id })) ?? []}
            value={selectedWorkflowId}
            onChange={(v) => setSelectedWorkflowId(v)}
            placeholder='Select a workflow'
            disabled={!workflows || workflows.length === 0 || isEditOutputMode}
            emptyMessage='No manual triggers configured'
            maxHeight={260}
            searchable
            searchPlaceholder='Search workflows...'
            error={showValidation && !selectedWorkflowId ? 'Select a workflow' : null}
          />
          {showValidation && !selectedWorkflowId && <FieldError message='Select a workflow' />}
        </div>

        <FieldDivider />

        <div className='flex flex-col gap-[9.5px]'>
          <RequiredLabel>{isEditOutputMode ? 'Output' : 'Output columns'}</RequiredLabel>
          <Combobox
            multiSelect={!outputPickerSingleSelect}
            searchable
            searchPlaceholder='Search outputs…'
            size='sm'
            className='h-[32px] w-full rounded-md'
            dropdownWidth='trigger'
            maxHeight={280}
            disabled={workflowState.isLoading || blockOutputGroups.length === 0}
            emptyMessage={workflowState.isLoading ? 'Loading workflow…' : 'No outputs found.'}
            // Combobox ignores `options` when `groups` is set (see combobox.tsx),
            // but the prop is required by the type — pass an empty array.
            options={[]}
            groups={outputGroupOptions}
            {...(outputPickerSingleSelect
              ? {
                  value: selectedOutputs[0] ?? '',
                  onChange: (v: string) => setSelectedOutputs(v ? [v] : []),
                }
              : {
                  multiSelectValues: selectedOutputs,
                  onMultiSelectChange: setSelectedOutputs,
                  overlayContent: (
                    <span className='truncate text-[var(--text-primary)]'>
                      {selectedOutputs.length === 0
                        ? 'Select outputs'
                        : `${selectedOutputs.length} selected`}
                    </span>
                  ),
                })}
          />
          {showValidation && selectedWorkflowId && selectedOutputs.length === 0 && (
            <FieldError
              message={isEditOutputMode ? 'Pick an output' : 'Pick at least one output column'}
            />
          )}
        </div>

        {!isEditOutputMode && (
          <>
            <FieldDivider />
            <div className='flex items-center justify-between pl-0.5'>
              <Label htmlFor='workflow-sidebar-auto-run'>Auto-run workflow</Label>
              <Switch
                id='workflow-sidebar-auto-run'
                checked={autoRun}
                onCheckedChange={(v) => setAutoRun(!!v)}
              />
            </div>
            {autoRun && (
              <>
                <FieldDivider />
                <RunSettingsSection depOptions={depOptions} deps={deps} onChangeDeps={setDeps} />
              </>
            )}
          </>
        )}
      </div>

      <div className='flex items-center justify-end gap-2 border-[var(--border)] border-t px-2 py-3'>
        <Button variant='default' size='sm' onClick={onClose}>
          Cancel
        </Button>
        <Button variant='primary' size='sm' onClick={handleSave} disabled={saveDisabled}>
          {saveDisabled ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
