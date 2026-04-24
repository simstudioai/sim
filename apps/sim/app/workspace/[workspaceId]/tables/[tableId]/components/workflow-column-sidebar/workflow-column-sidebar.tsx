'use client'

import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
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
import { TABLE_LIMITS } from '@/lib/table/constants'
import {
  flattenWorkflowOutputs,
  type FlattenOutputsBlockInput,
  type FlattenOutputsEdgeInput,
} from '@/lib/workflows/blocks/flatten-outputs'
import type { ColumnDefinition } from '@/lib/table'
import { getBlock } from '@/blocks'
import { useWorkflowState } from '@/hooks/queries/workflows'
import {
  useUpdateColumn,
  useUpdateTableMetadata,
  type ManualTriggerWorkflow,
} from '@/hooks/queries/tables'

export type WorkflowColumnConfigState =
  | { mode: 'edit'; columnName: string }
  | { mode: 'new'; columnName: string; workflowId: string; proposedName: string }
  | null

interface WorkflowColumnSidebarProps {
  configState: WorkflowColumnConfigState
  onClose: () => void
  /** The current column record for edit mode. Null for new mode or closed. */
  existingColumn: ColumnDefinition | null
  allColumns: ColumnDefinition[]
  workflows: ManualTriggerWorkflow[] | undefined
  workspaceId: string
  tableId: string
  /**
   * Table-wide max concurrent workflow-column runs. Read from `table.metadata`.
   * Undefined means "not set" — the scheduler falls back to its default.
   */
  workflowColumnBatchSize: number | undefined
}

const FULL_OUTPUT = '__full__'
const BATCH_SIZE_MIN = 1
const BATCH_SIZE_MAX = 100

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
  const updateMetadata = useUpdateTableMetadata({ workspaceId, tableId })
  const open = configState !== null

  // The column we're configuring. In 'new' mode there's no record yet — we only have a
  // name and the picked workflowId. In 'edit' mode it's the real ColumnDefinition.
  const columnName =
    configState?.mode === 'edit'
      ? configState.columnName
      : configState?.mode === 'new'
        ? configState.columnName
        : ''

  const otherColumns = useMemo(
    () => (columnName ? allColumns.filter((c) => c.name !== columnName) : []),
    [columnName, allColumns]
  )

  // Local working state — persisted only on Save.
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  const [deps, setDeps] = useState<string[]>([])
  const [outputPath, setOutputPath] = useState<string>(FULL_OUTPUT)
  const [batchSizeInput, setBatchSizeInput] = useState<string>('')

  // Re-seed local state whenever the panel is (re)opened with different context.
  useEffect(() => {
    if (!open || !configState) return
    if (configState.mode === 'edit' && existingColumn?.workflowConfig) {
      setSelectedWorkflowId(existingColumn.workflowConfig.workflowId)
      setDeps(
        existingColumn.workflowConfig.dependencies ??
          allColumns.filter((c) => c.name !== existingColumn.name).map((c) => c.name)
      )
      setOutputPath(existingColumn.workflowConfig.outputPath || FULL_OUTPUT)
    } else if (configState.mode === 'new') {
      setSelectedWorkflowId(configState.workflowId)
      // Default: check every sibling column.
      setDeps(allColumns.filter((c) => c.name !== configState.columnName).map((c) => c.name))
      setOutputPath(FULL_OUTPUT)
    }
    setBatchSizeInput(
      String(workflowColumnBatchSize ?? TABLE_LIMITS.WORKFLOW_COLUMN_BATCH_SIZE)
    )
  }, [open, configState, existingColumn, allColumns, workflowColumnBatchSize])

  const selectedWorkflow = useMemo(
    () => workflows?.find((w) => w.workflowId === selectedWorkflowId),
    [workflows, selectedWorkflowId]
  )

  const workflowState = useWorkflowState(open && selectedWorkflowId ? selectedWorkflowId : undefined)

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
        items: items.map((f) => ({ label: f.path, value: f.path })),
      }
    })
  }, [workflowState.data])

  const toggleDep = (name: string) => {
    setDeps((prev) => (prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]))
  }

  const parsedBatchSize = Number.parseInt(batchSizeInput, 10)
  const batchSizeValid =
    Number.isFinite(parsedBatchSize) &&
    parsedBatchSize >= BATCH_SIZE_MIN &&
    parsedBatchSize <= BATCH_SIZE_MAX
  const previousBatchSize =
    workflowColumnBatchSize ?? TABLE_LIMITS.WORKFLOW_COLUMN_BATCH_SIZE
  const batchSizeChanged = batchSizeValid && parsedBatchSize !== previousBatchSize

  const handleSave = () => {
    if (!configState || !selectedWorkflowId) return
    if (!batchSizeValid) {
      toast.error(`Run concurrency must be between ${BATCH_SIZE_MIN} and ${BATCH_SIZE_MAX}`)
      return
    }
    const workflowConfig = {
      workflowId: selectedWorkflowId,
      dependencies: deps,
      outputPath: outputPath === FULL_OUTPUT ? undefined : outputPath,
    }

    if (batchSizeChanged) {
      updateMetadata.mutate({ workflowColumnBatchSize: parsedBatchSize })
    }

    if (configState.mode === 'new') {
      updateColumn.mutate(
        {
          columnName: configState.columnName,
          updates: {
            ...(configState.proposedName !== configState.columnName
              ? { name: configState.proposedName }
              : {}),
            type: 'workflow',
            workflowConfig,
          },
        },
        {
          onSuccess: () => {
            toast.success(`Saved "${configState.proposedName}"`)
            onClose()
          },
          onError: (err) => toast.error(err.message || 'Failed to save'),
        }
      )
      return
    }

    updateColumn.mutate(
      {
        columnName: configState.columnName,
        updates: { workflowConfig },
      },
      {
        onSuccess: () => {
          toast.success(`Saved "${configState.columnName}"`)
          onClose()
        },
        onError: (err) => toast.error(err.message || 'Failed to save'),
      }
    )
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
              <span className='font-medium text-[var(--text-tertiary)] text-caption'>Column</span>
              <span className='truncate font-medium text-[var(--text-secondary)] text-sm'>
                {configState?.mode === 'new' ? configState.proposedName : columnName}
              </span>
            </div>

            <div>
              <div className='mb-1.5 font-medium text-[var(--text-tertiary)] text-caption'>
                Workflow
              </div>
              <Combobox
                size='sm'
                className='!py-0.5 rounded-md px-2.5'
                options={
                  workflows?.map((wf) => ({ label: wf.workflowName, value: wf.workflowId })) ?? []
                }
                value={selectedWorkflowId}
                onChange={(v) => setSelectedWorkflowId(v)}
                placeholder='Select a workflow'
                disabled={!workflows || workflows.length === 0}
                emptyMessage='No manual triggers configured'
                maxHeight={260}
              />
              {selectedWorkflow && (
                <div className='mt-1.5 flex items-center gap-2'>
                  <span
                    className='h-2.5 w-2.5 shrink-0 rounded-sm border-[2px]'
                    style={{
                      backgroundColor: selectedWorkflow.workflowColor,
                      borderColor: `${selectedWorkflow.workflowColor}60`,
                      backgroundClip: 'padding-box',
                    }}
                  />
                  <span className='text-[var(--text-tertiary)] text-caption'>
                    {selectedWorkflow.workflowName}
                  </span>
                </div>
              )}
            </div>

            <div className='mt-3'>
              <div className='mb-2 font-medium text-[var(--text-tertiary)] text-caption'>
                Trigger when these columns are filled
              </div>
              <div className='-my-1 flex min-w-0 flex-col overflow-hidden rounded-md border border-[var(--border)]'>
                {otherColumns.length === 0 ? (
                  <div className='px-2 py-3 text-[var(--text-tertiary)] text-sm'>
                    No other columns.
                  </div>
                ) : (
                  otherColumns.map((c, idx) => {
                    const checked = deps.includes(c.name)
                    return (
                      <label
                        key={c.name}
                        className={cn(
                          'flex h-[40px] cursor-pointer items-center gap-2.5 px-2.5 hover:bg-[var(--surface-2)]',
                          idx < otherColumns.length - 1 && 'border-[var(--border)] border-b'
                        )}
                      >
                        <Checkbox
                          size='sm'
                          checked={checked}
                          onCheckedChange={() => toggleDep(c.name)}
                        />
                        <span className='font-medium text-[var(--text-secondary)] text-sm'>
                          {c.name}
                        </span>
                        <span className='ml-auto text-[var(--text-tertiary)] text-caption'>
                          {c.type}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
            </div>

            <div className='mt-3'>
              <div className='mb-2 font-medium text-[var(--text-tertiary)] text-caption'>
                Output field
              </div>
              <Combobox
                size='sm'
                className='!py-0.5 rounded-md px-2.5'
                groups={[
                  { items: [{ label: 'Full output', value: FULL_OUTPUT }] },
                  ...outputComboboxGroups,
                ]}
                options={[]}
                value={outputPath}
                onChange={(v) => setOutputPath(v)}
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
                Max workflow runs executed in parallel across all workflow columns in this
                table ({BATCH_SIZE_MIN}–{BATCH_SIZE_MAX}). Default{' '}
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
