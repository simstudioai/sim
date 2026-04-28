'use client'

import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RepeatIcon, SplitIcon, X } from 'lucide-react'
import {
  Button,
  Checkbox,
  Combobox,
  type ComboboxOptionGroup,
  Input,
  toast,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition } from '@/lib/table'
import { TABLE_LIMITS } from '@/lib/table/constants'
import {
  type FlattenOutputsBlockInput,
  type FlattenOutputsEdgeInput,
  flattenWorkflowOutputs,
} from '@/lib/workflows/blocks/flatten-outputs'
import { getBlock } from '@/blocks'
import { useAddTableColumn, useUpdateColumn, useUpdateTableMetadata } from '@/hooks/queries/tables'
import { useWorkflowState } from '@/hooks/queries/workflows'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

export type WorkflowColumnConfigState =
  | { mode: 'edit'; columnName: string }
  | { mode: 'new'; columnName: string; workflowId: string; proposedName: string }
  | { mode: 'create'; columnName: string; workflowId: string; proposedName: string }
  | null

interface WorkflowColumnSidebarProps {
  configState: WorkflowColumnConfigState
  onClose: () => void
  /** The current column record for edit mode. Null for new mode or closed. */
  existingColumn: ColumnDefinition | null
  allColumns: ColumnDefinition[]
  workflows: WorkflowMetadata[] | undefined
  workspaceId: string
  tableId: string
  /**
   * Table-wide max concurrent workflow-column runs. Read from `table.metadata`.
   * Undefined means "not set" — the scheduler falls back to its default.
   */
  workflowColumnBatchSize: number | undefined
}

const FULL_OUTPUT = '__full__'
const NO_OUTPUT = ''
const OUTPUT_VALUE_SEPARATOR = '::'
const BATCH_SIZE_MIN = 1
const BATCH_SIZE_MAX = 100

/** Encodes blockId + path so duplicate field names across blocks stay distinct. */
const encodeOutputValue = (blockId: string, path: string) =>
  `${blockId}${OUTPUT_VALUE_SEPARATOR}${path}`

/** Strips the blockId prefix; returns the bare path that gets persisted as outputPath. */
const decodeOutputPath = (value: string) => {
  const idx = value.indexOf(OUTPUT_VALUE_SEPARATOR)
  return idx === -1 ? value : value.slice(idx + OUTPUT_VALUE_SEPARATOR.length)
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
 * Right-edge configuration panel for a workflow column.
 *
 * Two modes:
 * - 'edit': modify an existing workflow column. Mutation sends just workflowConfig.
 * - 'new':  user just picked a workflow via Change type → Workflow → [pick]. Nothing
 *           is persisted yet. Save writes type + workflowConfig + renames the column
 *           in a single PATCH; Cancel drops the picked workflow and leaves the column
 *           unchanged.
 *
 * Positioned absolute inside the table's container so it slides in under the resource
 * header and options bar, not on top of the workspace nav.
 */
export function WorkflowColumnSidebar({
  configState,
  onClose,
  existingColumn,
  allColumns,
  workflows,
  workspaceId,
  tableId,
  workflowColumnBatchSize,
}: WorkflowColumnSidebarProps) {
  const updateColumn = useUpdateColumn({ workspaceId, tableId })
  const addColumn = useAddTableColumn({ workspaceId, tableId })
  const updateMetadata = useUpdateTableMetadata({ workspaceId, tableId })
  const open = configState !== null

  // The column we're configuring. In 'edit' mode it's the real ColumnDefinition.
  // In 'new' mode the column exists but isn't yet a workflow column. In 'create'
  // mode no column exists yet and we'll POST one on Save.
  const columnName = configState ? configState.columnName : ''

  const otherColumns = useMemo(
    () => (columnName ? allColumns.filter((c) => c.name !== columnName) : []),
    [columnName, allColumns]
  )

  // Local working state — persisted only on Save.
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  const [deps, setDeps] = useState<string[]>([])
  const [outputValue, setOutputValue] = useState<string>(NO_OUTPUT)
  const [batchSizeInput, setBatchSizeInput] = useState<string>('')
  const [nameInput, setNameInput] = useState<string>('')

  // Kept in refs so query-refetch churn on the source props doesn't reseed the
  // working state and wipe the user's unsaved edits.
  const existingColumnRef = useRef(existingColumn)
  existingColumnRef.current = existingColumn
  const allColumnsRef = useRef(allColumns)
  allColumnsRef.current = allColumns
  const workflowColumnBatchSizeRef = useRef(workflowColumnBatchSize)
  workflowColumnBatchSizeRef.current = workflowColumnBatchSize

  // Seed only on panel open or when the target changes — deliberately not on
  // prop-reference churn from refetches.
  useEffect(() => {
    if (!open || !configState) return
    const existing = existingColumnRef.current
    const cols = allColumnsRef.current
    if (configState.mode === 'edit' && existing?.workflowConfig) {
      setSelectedWorkflowId(existing.workflowConfig.workflowId)
      setDeps(
        existing.workflowConfig.dependencies ??
          cols.filter((c) => c.name !== existing.name).map((c) => c.name)
      )
      setOutputValue(existing.workflowConfig.outputPath ?? NO_OUTPUT)
      setNameInput(existing.name)
    } else if (configState.mode === 'new' || configState.mode === 'create') {
      setSelectedWorkflowId(configState.workflowId)
      setDeps(cols.filter((c) => c.name !== configState.columnName).map((c) => c.name))
      setOutputValue(NO_OUTPUT)
      setNameInput(configState.proposedName)
    }
    setBatchSizeInput(
      String(workflowColumnBatchSizeRef.current ?? TABLE_LIMITS.WORKFLOW_COLUMN_BATCH_SIZE)
    )
  }, [open, configState])

  const workflowState = useWorkflowState(
    open && selectedWorkflowId ? selectedWorkflowId : undefined
  )

  /**
   * Build Combobox groups from the flattened outputs. Flatten logic is shared with the
   * deploy modal's OutputSelect in `@/lib/workflows/blocks/flatten-outputs`; only the
   * presentation (icon + section header) lives here.
   */
  const outputComboboxGroups = useMemo<ComboboxOptionGroup[]>(() => {
    const state = workflowState.data as
      | {
          blocks?: Record<string, FlattenOutputsBlockInput>
          edges?: FlattenOutputsEdgeInput[]
        }
      | null
      | undefined
    if (!state?.blocks) return []

    const blocks = Object.values(state.blocks)
    const flat = flattenWorkflowOutputs(blocks, state.edges ?? [])
    if (flat.length === 0) return []

    const groupsByBlock = new Map<string, typeof flat>()
    for (const f of flat) {
      const list = groupsByBlock.get(f.blockName) ?? []
      list.push(f)
      groupsByBlock.set(f.blockName, list)
    }

    return Array.from(groupsByBlock.entries()).map(([blockName, items]) => {
      const first = items[0]
      const blockConfig = getBlock(first.blockType)
      const blockColor = blockConfig?.bgColor || '#2F55FF'
      let blockIcon: string | React.ComponentType<{ className?: string }> = blockName
        .charAt(0)
        .toUpperCase()
      if (blockConfig?.icon) blockIcon = blockConfig.icon
      else if (first.blockType === 'loop') blockIcon = RepeatIcon
      else if (first.blockType === 'parallel') blockIcon = SplitIcon

      return {
        sectionElement: (
          <div className='flex items-center gap-1.5 px-1.5 py-1'>
            <TagIcon icon={blockIcon} color={blockColor} />
            <span className='font-medium text-small'>{blockName}</span>
          </div>
        ),
        items: items.map((f) => ({
          label: f.path,
          value: encodeOutputValue(f.blockId, f.path),
        })),
      }
    })
  }, [workflowState.data])

  // Re-encode a stored bare path once block options arrive so the picker can
  // pre-select the matching option (option values are blockId-prefixed for
  // uniqueness, but stored outputPath is just the bare dot-path).
  useEffect(() => {
    if (!outputValue || outputValue === FULL_OUTPUT) return
    if (outputValue.includes(OUTPUT_VALUE_SEPARATOR)) return
    for (const group of outputComboboxGroups) {
      for (const item of group.items) {
        if (decodeOutputPath(item.value) === outputValue) {
          setOutputValue(item.value)
          return
        }
      }
    }
  }, [outputComboboxGroups, outputValue])

  const toggleDep = (name: string) => {
    setDeps((prev) => (prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]))
  }

  const parsedBatchSize = Number.parseInt(batchSizeInput, 10)
  const batchSizeValid =
    Number.isFinite(parsedBatchSize) &&
    parsedBatchSize >= BATCH_SIZE_MIN &&
    parsedBatchSize <= BATCH_SIZE_MAX
  const previousBatchSize = workflowColumnBatchSize ?? TABLE_LIMITS.WORKFLOW_COLUMN_BATCH_SIZE
  const batchSizeChanged = batchSizeValid && parsedBatchSize !== previousBatchSize

  const handleSave = async () => {
    if (!configState || !selectedWorkflowId) return
    if (!batchSizeValid) {
      toast.error(`Run concurrency must be between ${BATCH_SIZE_MIN} and ${BATCH_SIZE_MAX}`)
      return
    }
    const trimmedName = nameInput.trim()
    if (!trimmedName) {
      toast.error('Column name is required')
      return
    }
    const workflowConfig = {
      workflowId: selectedWorkflowId,
      dependencies: deps,
      outputPath:
        outputValue === FULL_OUTPUT || outputValue === NO_OUTPUT
          ? undefined
          : decodeOutputPath(outputValue),
    }

    try {
      // Metadata must land before the column mutation runs. Both invalidate
      // `tableKeys.detail(tableId)` on settle, and if the column invalidation's
      // refetch lands before the metadata PUT commits to DB, the cache gets
      // clobbered with the old metadata.
      if (batchSizeChanged) {
        await updateMetadata.mutateAsync({ workflowColumnBatchSize: parsedBatchSize })
      }

      if (configState.mode === 'create') {
        await addColumn.mutateAsync({
          name: trimmedName,
          type: 'workflow',
          workflowConfig,
        })
        toast.success(`Added "${trimmedName}"`)
      } else if (configState.mode === 'new') {
        await updateColumn.mutateAsync({
          columnName: configState.columnName,
          updates: {
            ...(trimmedName !== configState.columnName ? { name: trimmedName } : {}),
            type: 'workflow',
            workflowConfig,
          },
        })
        toast.success(`Saved "${trimmedName}"`)
      } else {
        const renamed = trimmedName !== configState.columnName
        await updateColumn.mutateAsync({
          columnName: configState.columnName,
          updates: {
            ...(renamed ? { name: trimmedName } : {}),
            workflowConfig,
          },
        })
        toast.success(`Saved "${trimmedName}"`)
      }

      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save'
      toast.error(message)
    }
  }

  return (
    <aside
      role='dialog'
      aria-label='Configure workflow column'
      className={cn(
        'absolute top-0 right-0 bottom-0 z-50 flex w-[400px] flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--bg)] shadow-md transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      <div className='flex h-full flex-col px-3.5 pt-3'>
        <div className='flex items-center justify-between'>
          <h2 className='font-medium text-[var(--text-primary)] text-sm'>Configure column</h2>
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

        <div className='mt-5 flex-1 overflow-y-auto'>
          <div className='flex flex-col gap-2.5 pb-4'>
            <div className='flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2'>
              <label
                htmlFor='workflow-column-name'
                className='font-medium text-[var(--text-tertiary)] text-caption'
              >
                Column Name
              </label>
              <Input
                id='workflow-column-name'
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className='!h-auto !bg-transparent !border-0 !px-0 !py-0 !text-sm focus-visible:!ring-0 font-medium text-[var(--text-secondary)]'
                spellCheck={false}
                autoComplete='off'
              />
            </div>

            <div>
              <div className='mb-1.5 font-medium text-[var(--text-tertiary)] text-caption'>
                Workflow
              </div>
              <Combobox
                size='sm'
                className='!py-0.5 rounded-md px-2.5'
                options={workflows?.map((wf) => ({ label: wf.name, value: wf.id })) ?? []}
                value={selectedWorkflowId}
                onChange={(v) => setSelectedWorkflowId(v)}
                placeholder='Select a workflow'
                disabled={!workflows || workflows.length === 0}
                emptyMessage='No manual triggers configured'
                maxHeight={260}
              />
            </div>

            <div className='mt-3'>
              <div className='mb-2 font-medium text-[var(--text-tertiary)] text-caption'>
                Output field
              </div>
              <Combobox
                size='sm'
                className='!py-0.5 rounded-md px-2.5'
                groups={[
                  ...outputComboboxGroups,
                  { items: [{ label: 'Full output', value: FULL_OUTPUT }] },
                ]}
                options={[]}
                value={outputValue}
                onChange={(v) => setOutputValue(v)}
                placeholder='Select outputs'
                isLoading={workflowState.isLoading}
                maxHeight={260}
                emptyMessage='No outputs found'
              />
              <div className='mt-1.5 text-[var(--text-tertiary)] text-caption'>
                Pick one field from the workflow, or store the full output.
              </div>
            </div>

            <div className='mt-3'>
              <div className='mb-2 font-medium text-[var(--text-tertiary)] text-caption'>
                Trigger when these columns are filled
              </div>
              <div className='-my-1 flex max-h-[240px] min-w-0 flex-col overflow-y-auto rounded-md border border-[var(--border)]'>
                {otherColumns.length === 0 ? (
                  <div className='px-2 py-3 text-[var(--text-tertiary)] text-sm'>
                    No other columns.
                  </div>
                ) : (
                  otherColumns.map((c, idx) => {
                    const checked = deps.includes(c.name)
                    return (
                      <div
                        key={c.name}
                        role='checkbox'
                        aria-checked={checked}
                        tabIndex={0}
                        onClick={() => toggleDep(c.name)}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault()
                            toggleDep(c.name)
                          }
                        }}
                        className={cn(
                          'flex h-[40px] flex-shrink-0 cursor-pointer items-center gap-2.5 px-2.5 hover:bg-[var(--surface-2)]',
                          idx < otherColumns.length - 1 && 'border-[var(--border)] border-b'
                        )}
                      >
                        <Checkbox size='sm' checked={checked} className='pointer-events-none' />
                        <span className='font-medium text-[var(--text-secondary)] text-sm'>
                          {c.name}
                        </span>
                        <span className='ml-auto text-[var(--text-tertiary)] text-caption'>
                          {c.type}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div className='mt-3'>
              <div className='mb-2 font-medium text-[var(--text-tertiary)] text-caption'>
                Run concurrency
              </div>
              <Input
                type='number'
                inputMode='numeric'
                min={BATCH_SIZE_MIN}
                max={BATCH_SIZE_MAX}
                step={1}
                value={batchSizeInput}
                onChange={(e) => setBatchSizeInput(e.target.value)}
                aria-invalid={!batchSizeValid}
              />
              <div className='mt-1.5 text-[var(--text-tertiary)] text-caption'>
                Max workflow runs executed in parallel across all workflow columns in this table (
                {BATCH_SIZE_MIN}–{BATCH_SIZE_MAX}). Default{' '}
                {TABLE_LIMITS.WORKFLOW_COLUMN_BATCH_SIZE}.
              </div>
            </div>
          </div>
        </div>

        <div className='flex items-center justify-end gap-2 border-[var(--border)] border-t px-1 py-3'>
          <Button variant='ghost' size='sm' onClick={onClose}>
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={handleSave}
            disabled={updateColumn.isPending || !selectedWorkflowId || !batchSizeValid}
          >
            {updateColumn.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </aside>
  )
}
