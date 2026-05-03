'use client'

import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  RepeatIcon,
  SplitIcon,
  X,
} from 'lucide-react'
import {
  Button,
  Checkbox,
  Combobox,
  Expandable,
  ExpandableContent,
  Input,
  Label,
  Switch,
  Tooltip,
  toast,
} from '@/components/emcn'
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
  useAddTableColumn,
  useAddWorkflowGroup,
  useUpdateColumn,
  useUpdateWorkflowGroup,
} from '@/hooks/queries/tables'
import { useWorkflowState, workflowKeys } from '@/hooks/queries/workflows'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { COLUMN_TYPE_OPTIONS, type SidebarColumnType } from './column-types'

export type ColumnConfigState =
  | { mode: 'edit'; columnName: string }
  | { mode: 'new'; columnName: string; workflowId: string; proposedName: string }
  | {
      mode: 'create'
      columnName: string
      proposedName: string
      /** When present, the sidebar opens with the workflow type pre-selected. */
      workflowId?: string
    }
  | null

interface ColumnSidebarProps {
  configState: ColumnConfigState
  onClose: () => void
  /** The current column record for edit mode. Null for new mode or closed. */
  existingColumn: ColumnDefinition | null
  allColumns: ColumnDefinition[]
  workflowGroups: WorkflowGroup[]
  workflows: WorkflowMetadata[] | undefined
  workspaceId: string
  tableId: string
}

const OUTPUT_VALUE_SEPARATOR = '::'

/** Shared dashed-divider style — mirrors the workflow editor's subblock divider. */
const DASHED_DIVIDER_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(to right, var(--border) 0px, var(--border) 6px, transparent 6px, transparent 12px)',
} as const

/** Encodes blockId + path so duplicate field names across blocks stay distinct in the picker UI. */
const encodeOutputValue = (blockId: string, path: string) =>
  `${blockId}${OUTPUT_VALUE_SEPARATOR}${path}`

/** Splits an encoded `${blockId}::${path}` into its components for persistence. */
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

/**
 * Loose shape of `useWorkflowState` data — we only need the fields we round-trip
 * through PUT /state. Typed locally to avoid pulling the heavy `WorkflowState`
 * generic from `@/stores/workflows/workflow/types`.
 */
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

function FieldDivider() {
  return (
    <div className='px-0.5 pt-4 pb-[13px]'>
      <div className='h-[1.25px]' style={DASHED_DIVIDER_STYLE} />
    </div>
  )
}

/** Mirrors the workflow editor's required-field label: title + asterisk. */
function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <Label htmlFor={htmlFor} className='flex items-baseline gap-1.5 whitespace-nowrap pl-0.5'>
      {children}
      {required && <span className='ml-0.5'>*</span>}
    </Label>
  )
}

/** Inline validation message styled like the workflow editor's destructive text. */
function FieldError({ message }: { message: string }) {
  return <p className='pl-0.5 text-caption text-destructive'>{message}</p>
}

/**
 * Tinted inline warning row with a message on the left and an action button
 * on the right. Stacks naturally — render multiple in sequence and they line
 * up. Color mirrors the group-header deploy badge: `red` for blocking states,
 * `amber` for soft warnings.
 */
function WarningRow({
  tone,
  message,
  action,
}: {
  tone: 'red' | 'amber'
  message: string
  action: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-2.5 py-2',
        tone === 'red'
          ? 'border-[color-mix(in_srgb,var(--text-error)_40%,transparent)] bg-[color-mix(in_srgb,var(--text-error)_10%,transparent)]'
          : 'border-[var(--terminal-status-warning-border)] bg-[var(--terminal-status-warning-bg)]'
      )}
      role='status'
    >
      <span
        className={cn(
          'min-w-0 flex-1 text-caption',
          tone === 'red'
            ? 'text-[var(--text-error)]'
            : 'text-[var(--terminal-status-warning-color)]'
        )}
      >
        {message}
      </span>
      <div className='shrink-0'>{action}</div>
    </div>
  )
}

/**
 * Collapsible "Run settings" section. Collapsed by default since outputs are
 * the primary focus of the workflow flow — most users never need to touch
 * the trigger conditions. The header shows a one-line summary of when the
 * group will fire so the current state is visible without expanding.
 */
function RunSettingsSection({
  open,
  onOpenChange,
  summary,
  scalarDepColumns,
  groupDepOptions,
  deps,
  groupDeps,
  workflows,
  onToggleDep,
  onToggleGroupDep,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: string
  scalarDepColumns: ColumnDefinition[]
  groupDepOptions: WorkflowGroup[]
  deps: string[]
  groupDeps: string[]
  workflows: WorkflowMetadata[] | undefined
  onToggleDep: (name: string) => void
  onToggleGroupDep: (groupId: string) => void
}) {
  return (
    <div className='flex flex-col gap-[9.5px]'>
      <button
        type='button'
        onClick={() => onOpenChange(!open)}
        className='flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-md pl-0.5 text-left transition-colors hover:bg-[var(--surface-2)]'
        aria-expanded={open}
      >
        <span className='flex items-center gap-1.5'>
          {open ? (
            <ChevronDown className='h-[12px] w-[12px] shrink-0 text-[var(--text-muted)]' />
          ) : (
            <ChevronRight className='h-[12px] w-[12px] shrink-0 text-[var(--text-muted)]' />
          )}
          <span className='font-medium text-[var(--text-primary)] text-small'>Run settings</span>
        </span>
        {!open && (
          <span className='break-words pl-[18px] text-[var(--text-tertiary)] text-caption'>
            {summary}
          </span>
        )}
      </button>
      <Expandable expanded={open}>
        <ExpandableContent>
          <div className='flex max-h-[240px] min-w-0 flex-col overflow-y-auto rounded-md border border-[var(--border)]'>
            {scalarDepColumns.length === 0 && groupDepOptions.length === 0 ? (
              <div className='px-2 py-3 text-[var(--text-tertiary)] text-small'>
                No upstream columns or groups.
              </div>
            ) : (
              <>
                {scalarDepColumns.map((c, idx) => {
                  const checked = deps.includes(c.name)
                  const isLast = idx === scalarDepColumns.length - 1 && groupDepOptions.length === 0
                  return (
                    <div
                      key={`col:${c.name}`}
                      role='checkbox'
                      aria-checked={checked}
                      tabIndex={0}
                      onClick={() => onToggleDep(c.name)}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault()
                          onToggleDep(c.name)
                        }
                      }}
                      className={cn(
                        'flex h-[36px] flex-shrink-0 cursor-pointer items-center gap-2.5 px-2.5 hover:bg-[var(--surface-2)]',
                        !isLast && 'border-[var(--border)] border-b'
                      )}
                    >
                      <Checkbox size='sm' checked={checked} className='pointer-events-none' />
                      <span className='font-medium text-[var(--text-secondary)] text-small'>
                        {c.name}
                      </span>
                      <span className='ml-auto text-[var(--text-tertiary)] text-caption'>
                        {c.type}
                      </span>
                    </div>
                  )
                })}
                {groupDepOptions.map((g, idx) => {
                  const checked = groupDeps.includes(g.id)
                  const isLast = idx === groupDepOptions.length - 1
                  const wf = workflows?.find((w) => w.id === g.workflowId)
                  const color = wf?.color ?? 'var(--text-muted)'
                  const label = g.name ?? wf?.name ?? 'Workflow'
                  return (
                    <div
                      key={`group:${g.id}`}
                      role='checkbox'
                      aria-checked={checked}
                      tabIndex={0}
                      onClick={() => onToggleGroupDep(g.id)}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault()
                          onToggleGroupDep(g.id)
                        }
                      }}
                      className={cn(
                        'flex h-[36px] flex-shrink-0 cursor-pointer items-center gap-2.5 px-2.5 hover:bg-[var(--surface-2)]',
                        !isLast && 'border-[var(--border)] border-b'
                      )}
                    >
                      <Checkbox size='sm' checked={checked} className='pointer-events-none' />
                      <span
                        className='h-[10px] w-[10px] shrink-0 rounded-sm'
                        style={{ backgroundColor: color }}
                        aria-hidden='true'
                      />
                      <span className='min-w-0 truncate font-medium text-[var(--text-secondary)] text-small'>
                        {label}
                      </span>
                      <span className='ml-auto text-[var(--text-tertiary)] text-caption'>
                        workflow
                      </span>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </ExpandableContent>
      </Expandable>
    </div>
  )
}

/**
 * Right-edge configuration panel for any column.
 *
 * Shows name / type / unique for every column, plus workflow-specific fields
 * (workflow picker, output field, dependencies, run concurrency) when the
 * selected type is `'workflow'`.
 *
 * Three modes:
 * - 'edit':   modify an existing column. PATCH sends a unified updates payload.
 * - 'new':    user picked a workflow via Change type → Workflow → [pick]. Nothing
 *             is persisted yet. Save writes type + workflowConfig + renames in one PATCH.
 * - 'create': user picked a workflow from "Add column"; the column doesn't exist yet
 *             and Save creates it.
 *
 * Visual styling mirrors the workflow editor's subblock panel (label above
 * control, dashed dividers between fields).
 */
export function ColumnSidebar({
  configState,
  onClose,
  existingColumn,
  allColumns,
  workflowGroups,
  workflows,
  workspaceId,
  tableId,
}: ColumnSidebarProps) {
  const updateColumn = useUpdateColumn({ workspaceId, tableId })
  const addColumn = useAddTableColumn({ workspaceId, tableId })
  const addWorkflowGroup = useAddWorkflowGroup({ workspaceId, tableId })
  const updateWorkflowGroup = useUpdateWorkflowGroup({ workspaceId, tableId })
  const open = configState !== null

  const columnName = configState ? configState.columnName : ''

  /**
   * If the column being edited is a workflow output, resolve its parent group
   * so we can populate workflow / outputs / dependencies state from it.
   */
  const existingGroup = useMemo<WorkflowGroup | undefined>(() => {
    if (!existingColumn?.workflowGroupId) return undefined
    return workflowGroups.find((g) => g.id === existingColumn.workflowGroupId)
  }, [existingColumn, workflowGroups])

  const [nameInput, setNameInput] = useState<string>('')
  const [typeInput, setTypeInput] = useState<SidebarColumnType>('string')

  const isWorkflow = !!existingGroup || configState?.mode === 'new' || typeInput === 'workflow'

  /**
   * Show the Column name field whenever a *specific* column is open: scalar
   * columns (create or edit) and per-output workflow columns (edit only). Hide
   * it when the surface is the workflow-group as a whole — i.e. creating a
   * brand-new workflow column where individual output names are auto-derived.
   */
  const showColumnNameField =
    !isWorkflow || configState?.mode === 'edit' || configState?.mode === 'new'

  /**
   * Columns to the left of the current column — these are the only valid trigger
   * dependencies, since a workflow column can't depend on values that haven't been
   * filled yet. For 'create' mode the column doesn't exist yet, so every existing
   * column counts as left of it.
   */
  const otherColumns = useMemo(() => {
    if (!configState) return []
    if (configState.mode === 'create') return allColumns
    const idx = allColumns.findIndex((c) => c.name === configState.columnName)
    if (idx === -1) return allColumns.filter((c) => c.name !== configState.columnName)
    return allColumns.slice(0, idx)
  }, [configState, allColumns])

  /**
   * Split `otherColumns` into the two dep buckets:
   * - `scalarDepColumns` — plain columns; tickable into `dependencies.columns`.
   * - `groupDepOptions` — producing workflow groups whose outputs land left of the
   *   current column; tickable into `dependencies.workflowGroups`. A group only
   *   shows up here when at least one of its output columns is left-of-current.
   *   The current group itself is excluded so we never depend on ourselves.
   */
  const scalarDepColumns = useMemo(
    () => otherColumns.filter((c) => !c.workflowGroupId),
    [otherColumns]
  )
  const groupDepOptions = useMemo<WorkflowGroup[]>(() => {
    const seen = new Set<string>()
    const result: WorkflowGroup[] = []
    for (const c of otherColumns) {
      if (!c.workflowGroupId) continue
      if (seen.has(c.workflowGroupId)) continue
      if (existingGroup && c.workflowGroupId === existingGroup.id) continue
      const g = workflowGroups.find((gg) => gg.id === c.workflowGroupId)
      if (!g) continue
      seen.add(c.workflowGroupId)
      result.push(g)
    }
    return result
  }, [otherColumns, workflowGroups, existingGroup])

  const [uniqueInput, setUniqueInput] = useState<boolean>(false)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  /** Plain (non-workflow-output) column names this group waits on. */
  const [deps, setDeps] = useState<string[]>([])
  /** Producing workflow group ids this group waits on. Workflow-output columns are
   *  represented by their parent group, since the schema validator forbids depending
   *  on a workflow-output column directly (`workflow-columns.ts` enforces this). */
  const [groupDeps, setGroupDeps] = useState<string[]>([])
  /** Encoded `${blockId}::${path}` values — disambiguates duplicate paths in the picker. */
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([])
  /** Surfaces required-field errors only after a save attempt, matching the workflow editor's deploy flow. */
  const [showValidation, setShowValidation] = useState(false)
  /** Save-time error (network/validation thrown by the mutation). Rendered inline next to the footer
   *  buttons so it isn't covered by the toaster, which sits over the bottom-right of the panel. */
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Run settings (the trigger-deps picker) starts collapsed — outputs are the
   *  primary task; configuring run timing is rare. */
  const [runSettingsOpen, setRunSettingsOpen] = useState(false)

  const existingColumnRef = useRef(existingColumn)
  existingColumnRef.current = existingColumn
  const allColumnsRef = useRef(allColumns)
  allColumnsRef.current = allColumns

  useEffect(() => {
    if (!open || !configState) return
    setShowValidation(false)
    setSaveError(null)
    setRunSettingsOpen(false)
    const existing = existingColumnRef.current
    const cols = allColumnsRef.current
    const leftOfCurrent = (() => {
      if (configState.mode === 'create') return cols
      const idx = cols.findIndex((c) => c.name === configState.columnName)
      if (idx === -1) return cols.filter((c) => c.name !== configState.columnName)
      return cols.slice(0, idx)
    })()
    // Default deps when there's no persisted group yet: tick every left-of-current
    // scalar column + every left-of-current producing group.
    const defaultScalarDeps = leftOfCurrent.filter((c) => !c.workflowGroupId).map((c) => c.name)
    const defaultGroupDeps = (() => {
      const seen = new Set<string>()
      for (const c of leftOfCurrent) {
        if (c.workflowGroupId) seen.add(c.workflowGroupId)
      }
      return Array.from(seen)
    })()
    if (configState.mode === 'edit') {
      const group = existing?.workflowGroupId
        ? workflowGroups.find((g) => g.id === existing.workflowGroupId)
        : undefined
      // Surface workflow-typed columns as `'workflow'` in the combobox even
      // though they're stored as scalar columns under the hood.
      setTypeInput(group ? 'workflow' : (existing?.type ?? 'string'))
      setUniqueInput(!!existing?.unique)
      setNameInput(existing?.name ?? configState.columnName)
      if (group) {
        setSelectedWorkflowId(group.workflowId)
        // Sanitize legacy persisted deps: any workflow-output column names that
        // sneaked into `dependencies.columns` (writes from before the schema
        // validator forbade them) are lifted into `workflowGroups` here so the
        // sidebar surfaces a re-saveable state.
        const persistedCols = group.dependencies?.columns
        const persistedGroups = group.dependencies?.workflowGroups
        if (persistedCols !== undefined || persistedGroups !== undefined) {
          const liftedGroupIds = new Set(persistedGroups ?? [])
          const cleanCols: string[] = []
          for (const colName of persistedCols ?? []) {
            const c = cols.find((cc) => cc.name === colName)
            if (c?.workflowGroupId) liftedGroupIds.add(c.workflowGroupId)
            else cleanCols.push(colName)
          }
          setDeps(cleanCols)
          setGroupDeps(Array.from(liftedGroupIds))
        } else {
          setDeps(defaultScalarDeps)
          setGroupDeps(defaultGroupDeps)
        }
        setSelectedOutputs([]) // re-encoded against current workflow blocks below
      } else {
        setSelectedWorkflowId('')
        setDeps([])
        setGroupDeps([])
        setSelectedOutputs([])
      }
    } else {
      const workflowId =
        'workflowId' in configState && configState.workflowId ? configState.workflowId : ''
      setTypeInput(workflowId ? 'workflow' : 'string')
      setUniqueInput(false)
      setNameInput(configState.proposedName)
      setSelectedWorkflowId(workflowId)
      setDeps(defaultScalarDeps)
      setGroupDeps(defaultGroupDeps)
      setSelectedOutputs([])
    }
  }, [open, configState, workflowGroups])

  const workflowState = useWorkflowState(
    open && isWorkflow && selectedWorkflowId ? selectedWorkflowId : undefined
  )

  /**
   * Resolves the unified Start block id and its current `inputFormat` field
   * names. The "Add inputs" mutation only adds rows for table columns that
   * aren't already represented in the start block — clicking the button when
   * everything's covered does nothing, so we hide it in that case.
   */
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
    return allColumns
      .filter(
        (c) =>
          c.name !== columnName && !c.workflowGroupId && !startBlockInputs.existingNames.has(c.name)
      )
      .map((c) => c.name)
  }, [allColumns, columnName, startBlockInputs])

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
      // useWorkflowState; we round-trip it back to the strict PUT body shape.
      const body = rawBody as unknown as WorkflowStateContractInput
      await requestJson(putWorkflowNormalizedStateContract, {
        params: { id: wfId },
        body,
      })
      return missingInputColumnNames.length
    },
    onSuccess: (added) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.state(selectedWorkflowId) })
      toast.success(`Added ${added} input${added === 1 ? '' : 's'} to start block`)
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
    // Sort the picker by execution order (start block first) so it matches the
    // saved-column ordering. Unreachable blocks sink to the end.
    const distances = getBlockExecutionOrder(blocks, edges)
    return Array.from(groupsByBlockId.values()).sort((a, b) => {
      const da = distances[a.blockId]
      const db = distances[b.blockId]
      const sa = da === undefined || da < 0 ? Number.POSITIVE_INFINITY : da
      const sb = db === undefined || db < 0 ? Number.POSITIVE_INFINITY : db
      return sa - sb
    })
  }, [workflowState.data])

  /**
   * Re-encode persisted `{blockId, path}` entries into the picker's encoded form
   * once the workflow's blocks are loaded. Stale entries (block deleted or path
   * removed) are dropped silently — the user can re-pick on save.
   */
  useEffect(() => {
    if (!existingGroup?.outputs.length) return
    if (selectedOutputs.length > 0) return
    if (blockOutputGroups.length === 0) return
    const encoded: string[] = []
    for (const entry of existingGroup.outputs) {
      const match = blockOutputGroups.find(
        (g) => g.blockId === entry.blockId && g.paths.includes(entry.path)
      )
      if (match) encoded.push(encodeOutputValue(entry.blockId, entry.path))
    }
    if (encoded.length > 0) setSelectedOutputs(encoded)
  }, [blockOutputGroups, selectedOutputs.length, existingGroup])

  const toggleDep = (name: string) => {
    setDeps((prev) => (prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]))
  }

  const toggleGroupDep = (groupId: string) => {
    setGroupDeps((prev) =>
      prev.includes(groupId) ? prev.filter((d) => d !== groupId) : [...prev, groupId]
    )
  }

  const toggleOutput = (encoded: string) => {
    setSelectedOutputs((prev) =>
      prev.includes(encoded) ? prev.filter((v) => v !== encoded) : [...prev, encoded]
    )
  }

  const typeOptions = useMemo(
    () =>
      COLUMN_TYPE_OPTIONS.filter((o) => o.type !== 'workflow' || !!existingGroup).map((o) => ({
        label: o.label,
        value: o.type,
        icon: o.icon,
      })),
    [existingGroup]
  )

  /**
   * One-line summary of the trigger picker shown when Run settings is collapsed.
   * Lists the dep names ("Run when X, Y, are filled") so the user can see at a
   * glance whether anything's gating the group without expanding the section.
   */
  const runSettingsSummary = useMemo(() => {
    const names: string[] = [...deps]
    for (const gid of groupDeps) {
      const g = workflowGroups.find((gg) => gg.id === gid)
      const wf = workflows?.find((w) => w.id === g?.workflowId)
      const label = g?.name ?? wf?.name ?? 'workflow'
      names.push(label)
    }
    if (names.length === 0) return 'Runs as soon as the group is added'
    return `Runs when ${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} filled`
  }, [deps, groupDeps, workflowGroups, workflows])

  /**
   * Builds the ordered, deduplicated `(blockId, path)` list from the picker
   * state, sorted by execution order. Empty array if the user hasn't picked
   * anything.
   */
  const buildOrderedPickedOutputs = (): Array<{
    blockId: string
    path: string
    leafType?: string
  }> => {
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

  const handleSave = async () => {
    if (!configState) return
    setSaveError(null)
    const trimmedName = nameInput.trim()
    // Name is required iff the field is shown — when configuring a whole
    // workflow group at creation time, per-output column names are auto-derived
    // and the field is hidden, so don't gate save on it.
    const missing: string[] = []
    if (showColumnNameField && !trimmedName) missing.push('a column name')
    if (isWorkflow && !selectedWorkflowId) missing.push('a workflow')
    if (isWorkflow && selectedWorkflowId && selectedOutputs.length === 0) {
      missing.push('at least one output column')
    }
    if (missing.length > 0) {
      setShowValidation(true)
      // Surface a short summary near the Save button too — the inline FieldError
      // can be scrolled out of view when the panel content is tall.
      setSaveError(`Add ${missing.join(' and ')} before saving.`)
      return
    }

    try {
      if (isWorkflow) {
        const orderedOutputs = buildOrderedPickedOutputs()
        const dependencies: WorkflowGroupDependencies = {
          columns: deps,
          ...(groupDeps.length > 0 ? { workflowGroups: groupDeps } : {}),
        }

        if (existingGroup) {
          // Update path: diff outputs, derive new column names for added entries,
          // call updateWorkflowGroup so service handles add/remove transactionally.
          // If the sidebar was opened on a *specific* workflow-output column and
          // the user renamed it, propagate that into the group's `outputs` ref
          // (the column rename itself goes through `updateColumn` below, which
          // server-side cascades into outputs/deps — but our outgoing payload
          // also has to use the new name so the group update doesn't undo it).
          const editedColumnName = configState.mode === 'edit' ? configState.columnName : null
          const renamedColumn =
            editedColumnName && trimmedName && trimmedName !== editedColumnName
              ? { from: editedColumnName, to: trimmedName }
              : null
          const oldKeys = new Set(existingGroup.outputs.map((o) => `${o.blockId}::${o.path}`))
          const taken = new Set(
            allColumns.map((c) =>
              renamedColumn && c.name === renamedColumn.from ? renamedColumn.to : c.name
            )
          )
          const fullOutputs: WorkflowGroupOutput[] = []
          const newOutputColumns: NonNullable<UpdateWorkflowGroupBodyInput['newOutputColumns']> = []
          for (const o of orderedOutputs) {
            const key = `${o.blockId}::${o.path}`
            const existing = existingGroup.outputs.find(
              (e) => e.blockId === o.blockId && e.path === o.path
            )
            if (existing) {
              fullOutputs.push(
                renamedColumn && existing.columnName === renamedColumn.from
                  ? { ...existing, columnName: renamedColumn.to }
                  : existing
              )
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
            oldKeys.delete(key)
          }
          if (renamedColumn) {
            await updateColumn.mutateAsync({
              columnName: renamedColumn.from,
              updates: { name: renamedColumn.to },
            })
          }
          await updateWorkflowGroup.mutateAsync({
            groupId: existingGroup.id,
            workflowId: selectedWorkflowId,
            name: existingGroup.name,
            dependencies,
            outputs: fullOutputs,
            ...(newOutputColumns.length > 0 ? { newOutputColumns } : {}),
          })
          toast.success(`Saved "${existingGroup.name ?? 'Workflow'}"`)
        } else {
          // Create path: build a fresh group with auto-derived column names.
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
          const workflowName =
            workflows?.find((w) => w.id === selectedWorkflowId)?.name ?? 'Workflow'
          const group: WorkflowGroup = {
            id: groupId,
            workflowId: selectedWorkflowId,
            name: workflowName,
            dependencies,
            outputs: groupOutputs,
          }
          await addWorkflowGroup.mutateAsync({ group, outputColumns: newOutputColumns })
          toast.success(`Added "${workflowName}"`)
        }
      } else if (configState.mode === 'create') {
        // `isWorkflow` is false here, so `typeInput` is a real ColumnDefinition type.
        const scalarType = typeInput as ColumnDefinition['type']
        await addColumn.mutateAsync({
          name: trimmedName,
          type: scalarType,
        })
        toast.success(`Added "${trimmedName}"`)
      } else {
        const existing = existingColumnRef.current
        const scalarType = typeInput as ColumnDefinition['type']
        const renamed = trimmedName !== configState.columnName
        const typeChanged = !!existing && existing.type !== scalarType
        const uniqueChanged = !!existing && !!existing.unique !== uniqueInput

        const updates: {
          name?: string
          type?: ColumnDefinition['type']
          unique?: boolean
        } = {
          ...(renamed ? { name: trimmedName } : {}),
          ...(typeChanged ? { type: scalarType } : {}),
          ...(uniqueChanged ? { unique: uniqueInput } : {}),
        }

        if (Object.keys(updates).length === 0) {
          onClose()
          return
        }

        await updateColumn.mutateAsync({
          columnName: configState.columnName,
          updates,
        })
        toast.success(`Saved "${trimmedName}"`)
      }

      onClose()
    } catch (err) {
      setSaveError(toError(err).message)
    }
  }

  const saveDisabled = updateColumn.isPending || addColumn.isPending

  return (
    <aside
      role='dialog'
      aria-label='Configure column'
      className={cn(
        'absolute top-0 right-0 bottom-0 z-[var(--z-modal)] flex w-[400px] flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--bg)] shadow-overlay transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      <div className='flex h-full flex-col'>
        <div className='flex items-center justify-between border-[var(--border)] border-b px-3 py-2'>
          <h2 className='font-medium text-[var(--text-primary)] text-small'>Configure column</h2>
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
          <div className='flex flex-col gap-[9.5px]'>
            <FieldLabel required>Type</FieldLabel>
            <Combobox
              options={typeOptions}
              value={typeInput}
              onChange={(v) => setTypeInput(v as SidebarColumnType)}
              placeholder='Select type'
              maxHeight={260}
            />
          </div>

          {showColumnNameField && (
            <>
              <FieldDivider />

              <div className='flex flex-col gap-[9.5px]'>
                <FieldLabel htmlFor='column-sidebar-name' required>
                  Column name
                </FieldLabel>
                <Input
                  id='column-sidebar-name'
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  spellCheck={false}
                  autoComplete='off'
                  aria-invalid={showValidation && !nameInput.trim() ? true : undefined}
                />
                {showValidation && !nameInput.trim() && (
                  <FieldError message='Column name is required' />
                )}
              </div>
            </>
          )}

          {!isWorkflow && (
            <>
              <FieldDivider />

              <div className='flex flex-col gap-[9.5px]'>
                <div className='flex items-center justify-between pl-0.5'>
                  <Label htmlFor='column-sidebar-unique'>Unique</Label>
                  <Switch
                    id='column-sidebar-unique'
                    checked={uniqueInput}
                    onCheckedChange={(v) => setUniqueInput(!!v)}
                  />
                </div>
                <p className='pl-0.5 text-[var(--text-tertiary)] text-caption'>
                  Reject duplicate values across rows.
                </p>
              </div>
            </>
          )}

          {isWorkflow && (
            <>
              {selectedWorkflowId && (
                <>
                  <FieldDivider />

                  <div className='flex flex-col gap-[9.5px]'>
                    <Label className='pl-0.5'>Workflow preview</Label>
                    <div className='relative h-[160px] overflow-hidden rounded-sm border border-[var(--border)]'>
                      {workflowState.isLoading ? (
                        <div className='flex h-full items-center justify-center bg-[var(--surface-3)]'>
                          <Loader2 className='h-5 w-5 animate-spin text-[var(--text-tertiary)]' />
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
                </>
              )}

              <FieldDivider />

              <div className='flex flex-col gap-[9.5px]'>
                <FieldLabel required>Workflow</FieldLabel>
                <Combobox
                  options={workflows?.map((wf) => ({ label: wf.name, value: wf.id })) ?? []}
                  value={selectedWorkflowId}
                  onChange={(v) => setSelectedWorkflowId(v)}
                  placeholder='Select a workflow'
                  disabled={!workflows || workflows.length === 0}
                  emptyMessage='No manual triggers configured'
                  maxHeight={260}
                  searchable
                  searchPlaceholder='Search workflows...'
                  error={showValidation && !selectedWorkflowId ? 'Select a workflow' : null}
                />
                {showValidation && !selectedWorkflowId && (
                  <FieldError message='Select a workflow' />
                )}
                {selectedWorkflowId &&
                  startBlockInputs.blockId &&
                  missingInputColumnNames.length > 0 && (
                    <WarningRow
                      tone='amber'
                      message={`Start block missing ${missingInputColumnNames.length} table input${
                        missingInputColumnNames.length === 1 ? '' : 's'
                      }`}
                      action={
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <Button
                              type='button'
                              variant='default'
                              size='sm'
                              onClick={() => addInputsMutation.mutate()}
                              disabled={addInputsMutation.isPending}
                            >
                              <Plus className='h-[14px] w-[14px]' />
                              {addInputsMutation.isPending
                                ? 'Adding…'
                                : `Add inputs (${missingInputColumnNames.length})`}
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content side='top'>
                            Adds {missingInputColumnNames.join(', ')} to the workflow's Start block
                          </Tooltip.Content>
                        </Tooltip.Root>
                      }
                    />
                  )}
              </div>

              <FieldDivider />

              <div className='flex flex-col gap-[9.5px]'>
                <FieldLabel required>Output columns</FieldLabel>
                <p className='pl-0.5 text-[var(--text-tertiary)] text-caption'>
                  Each picked output becomes a column filled with the workflow's value for that
                  field.
                </p>
                <div className='flex max-h-[280px] min-w-0 flex-col overflow-y-auto rounded-md border border-[var(--border)]'>
                  {workflowState.isLoading ? (
                    <div className='px-2 py-3 text-[var(--text-tertiary)] text-small'>
                      Loading workflow…
                    </div>
                  ) : blockOutputGroups.length === 0 ? (
                    <div className='px-2 py-3 text-[var(--text-tertiary)] text-small'>
                      No outputs found.
                    </div>
                  ) : (
                    blockOutputGroups.map((group, gi) => (
                      <div
                        key={group.blockId}
                        className={cn(
                          gi < blockOutputGroups.length - 1 && 'border-[var(--border)] border-b'
                        )}
                      >
                        <div className='flex items-center gap-1.5 bg-[var(--surface-2)] px-2.5 py-1.5'>
                          <TagIcon icon={group.blockIcon} color={group.blockColor} />
                          <span className='font-medium text-[var(--text-secondary)] text-small'>
                            {group.blockName}
                          </span>
                        </div>
                        {group.paths.map((path) => {
                          const encoded = encodeOutputValue(group.blockId, path)
                          const checked = selectedOutputs.includes(encoded)
                          return (
                            <div
                              key={encoded}
                              role='checkbox'
                              aria-checked={checked}
                              tabIndex={0}
                              onClick={() => toggleOutput(encoded)}
                              onKeyDown={(e) => {
                                if (e.key === ' ' || e.key === 'Enter') {
                                  e.preventDefault()
                                  toggleOutput(encoded)
                                }
                              }}
                              className='flex h-[28px] flex-shrink-0 cursor-pointer items-center gap-2 px-2.5 hover:bg-[var(--surface-2)]'
                            >
                              <Checkbox
                                size='sm'
                                checked={checked}
                                className='pointer-events-none'
                              />
                              <span className='font-medium text-[var(--text-secondary)] text-small'>
                                {path}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    ))
                  )}
                </div>
                {showValidation && selectedWorkflowId && selectedOutputs.length === 0 && (
                  <FieldError message='Pick at least one output column' />
                )}
              </div>

              <FieldDivider />

              <RunSettingsSection
                open={runSettingsOpen}
                onOpenChange={setRunSettingsOpen}
                summary={runSettingsSummary}
                scalarDepColumns={scalarDepColumns}
                groupDepOptions={groupDepOptions}
                deps={deps}
                groupDeps={groupDeps}
                workflows={workflows}
                onToggleDep={toggleDep}
                onToggleGroupDep={toggleGroupDep}
              />
            </>
          )}
        </div>

        <div className='flex items-center gap-2 border-[var(--border)] border-t px-2 py-3'>
          {saveError ? (
            <p
              role='alert'
              className='min-w-0 flex-1 break-words pl-0.5 text-caption text-destructive'
            >
              {saveError}
            </p>
          ) : (
            <span className='flex-1' />
          )}
          <Button variant='default' size='sm' onClick={onClose}>
            Cancel
          </Button>
          <Button variant='primary' size='sm' onClick={handleSave} disabled={saveDisabled}>
            {updateColumn.isPending || addColumn.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </aside>
  )
}
