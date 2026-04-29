'use client'

import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toError } from '@sim/utils/errors'
import { ExternalLink, Loader2, RepeatIcon, SplitIcon, X } from 'lucide-react'
import { Button, Checkbox, Combobox, Input, Label, Switch, toast, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition } from '@/lib/table'
import {
  type FlattenOutputsBlockInput,
  type FlattenOutputsEdgeInput,
  flattenWorkflowOutputs,
  getBlockExecutionOrder,
} from '@/lib/workflows/blocks/flatten-outputs'
import { getBlock } from '@/blocks'
import { PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview'
import { useAddTableColumn, useUpdateColumn } from '@/hooks/queries/tables'
import { useWorkflowState } from '@/hooks/queries/workflows'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { COLUMN_TYPE_OPTIONS } from './column-types'

export type ColumnConfigState =
  | { mode: 'edit'; columnName: string }
  | { mode: 'new'; columnName: string; workflowId: string; proposedName: string }
  | { mode: 'create'; columnName: string; workflowId: string; proposedName: string }
  | null

interface ColumnSidebarProps {
  configState: ColumnConfigState
  onClose: () => void
  /** The current column record for edit mode. Null for new mode or closed. */
  existingColumn: ColumnDefinition | null
  allColumns: ColumnDefinition[]
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
  return <p className='pl-0.5 text-destructive text-caption'>{message}</p>
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
  workflows,
  workspaceId,
  tableId,
}: ColumnSidebarProps) {
  const updateColumn = useUpdateColumn({ workspaceId, tableId })
  const addColumn = useAddTableColumn({ workspaceId, tableId })
  const open = configState !== null

  const columnName = configState ? configState.columnName : ''

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

  const [nameInput, setNameInput] = useState<string>('')
  const [typeInput, setTypeInput] = useState<ColumnDefinition['type']>('string')
  const [uniqueInput, setUniqueInput] = useState<boolean>(false)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  const [deps, setDeps] = useState<string[]>([])
  /** Encoded `${blockId}::${path}` values — disambiguates duplicate paths in the picker. */
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([])
  /** Surfaces required-field errors only after a save attempt, matching the workflow editor's deploy flow. */
  const [showValidation, setShowValidation] = useState(false)

  const existingColumnRef = useRef(existingColumn)
  existingColumnRef.current = existingColumn
  const allColumnsRef = useRef(allColumns)
  allColumnsRef.current = allColumns

  useEffect(() => {
    if (!open || !configState) return
    setShowValidation(false)
    const existing = existingColumnRef.current
    const cols = allColumnsRef.current
    const leftOfCurrent = (() => {
      if (configState.mode === 'create') return cols
      const idx = cols.findIndex((c) => c.name === configState.columnName)
      if (idx === -1) return cols.filter((c) => c.name !== configState.columnName)
      return cols.slice(0, idx)
    })()
    if (configState.mode === 'edit') {
      const type = existing?.type ?? 'string'
      setTypeInput(type)
      setUniqueInput(!!existing?.unique)
      setNameInput(existing?.name ?? configState.columnName)
      if (existing?.workflowConfig) {
        setSelectedWorkflowId(existing.workflowConfig.workflowId)
        setDeps(existing.workflowConfig.dependencies ?? leftOfCurrent.map((c) => c.name))
        setSelectedOutputs([]) // re-encoded against current workflow blocks below
      } else {
        setSelectedWorkflowId('')
        setDeps([])
        setSelectedOutputs([])
      }
    } else {
      setTypeInput('workflow')
      setUniqueInput(false)
      setNameInput(configState.proposedName)
      setSelectedWorkflowId(configState.workflowId)
      setDeps(leftOfCurrent.map((c) => c.name))
      setSelectedOutputs([])
    }
  }, [open, configState])

  const workflowState = useWorkflowState(
    open && typeInput === 'workflow' && selectedWorkflowId ? selectedWorkflowId : undefined
  )

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
    if (!existingColumnRef.current?.workflowConfig?.outputs?.length) return
    if (selectedOutputs.length > 0) return
    if (blockOutputGroups.length === 0) return
    const saved = existingColumnRef.current.workflowConfig.outputs
    const encoded: string[] = []
    for (const entry of saved) {
      const match = blockOutputGroups.find(
        (g) => g.blockId === entry.blockId && g.paths.includes(entry.path)
      )
      if (match) encoded.push(encodeOutputValue(entry.blockId, entry.path))
    }
    if (encoded.length > 0) setSelectedOutputs(encoded)
  }, [blockOutputGroups, selectedOutputs.length])

  const toggleDep = (name: string) => {
    setDeps((prev) => (prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]))
  }

  const toggleOutput = (encoded: string) => {
    setSelectedOutputs((prev) =>
      prev.includes(encoded) ? prev.filter((v) => v !== encoded) : [...prev, encoded]
    )
  }

  const isWorkflow = typeInput === 'workflow'

  const typeOptions = useMemo(
    () => COLUMN_TYPE_OPTIONS.map((o) => ({ label: o.label, value: o.type, icon: o.icon })),
    []
  )

  const handleSave = async () => {
    if (!configState) return
    const trimmedName = nameInput.trim()
    if (!trimmedName || (isWorkflow && (!selectedWorkflowId || selectedOutputs.length === 0))) {
      setShowValidation(true)
      return
    }

    let workflowConfig: ColumnDefinition['workflowConfig'] | undefined
    if (isWorkflow) {
      const seen = new Set<string>()
      const outputs: Array<{ blockId: string; path: string }> = []
      for (const encoded of selectedOutputs) {
        if (seen.has(encoded)) continue
        seen.add(encoded)
        outputs.push(decodeOutputValue(encoded))
      }
      // Sort by execution order so fanned-out columns appear left-to-right
      // in the order their source blocks run. BFS distance from the start
      // block gives a clean linear order; same-distance ties fall back to
      // discovery order in `flattenWorkflowOutputs`.
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
      workflowConfig = {
        workflowId: selectedWorkflowId,
        dependencies: deps,
        outputs,
      }
    }

    try {
      if (configState.mode === 'create') {
        await addColumn.mutateAsync({
          name: trimmedName,
          type: typeInput,
          ...(workflowConfig ? { workflowConfig } : {}),
        })
        toast.success(`Added "${trimmedName}"`)
      } else {
        const existing = existingColumnRef.current
        const renamed = trimmedName !== configState.columnName
        const typeChanged = !!existing && existing.type !== typeInput
        const uniqueChanged = !!existing && !!existing.unique !== uniqueInput

        const updates: {
          name?: string
          type?: ColumnDefinition['type']
          unique?: boolean
          workflowConfig?: ColumnDefinition['workflowConfig']
        } = {
          ...(renamed ? { name: trimmedName } : {}),
          ...(typeChanged || configState.mode === 'new' ? { type: typeInput } : {}),
          ...(uniqueChanged ? { unique: uniqueInput } : {}),
          ...(workflowConfig ? { workflowConfig } : {}),
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
      toast.error(toError(err).message)
    }
  }

  const saveDisabled =
    updateColumn.isPending ||
    addColumn.isPending ||
    !nameInput.trim() ||
    (isWorkflow && (!selectedWorkflowId || selectedOutputs.length === 0))

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

          <FieldDivider />

          <div className='flex flex-col gap-[9.5px]'>
            <FieldLabel required>Type</FieldLabel>
            <Combobox
              options={typeOptions}
              value={typeInput}
              onChange={(v) => setTypeInput(v as ColumnDefinition['type'])}
              placeholder='Select type'
            />
          </div>

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
                  error={showValidation && !selectedWorkflowId ? 'Select a workflow' : null}
                />
                {showValidation && !selectedWorkflowId && (
                  <FieldError message='Select a workflow' />
                )}
              </div>

              <FieldDivider />

              <div className='flex flex-col gap-[9.5px]'>
                <Label className='pl-0.5'>Trigger when these columns are filled</Label>
                <div className='flex max-h-[240px] min-w-0 flex-col overflow-y-auto rounded-md border border-[var(--border)]'>
                  {otherColumns.length === 0 ? (
                    <div className='px-2 py-3 text-[var(--text-tertiary)] text-small'>
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
                            'flex h-[36px] flex-shrink-0 cursor-pointer items-center gap-2.5 px-2.5 hover:bg-[var(--surface-2)]',
                            idx < otherColumns.length - 1 && 'border-[var(--border)] border-b'
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
                    })
                  )}
                </div>
              </div>

              <FieldDivider />

              <div className='flex flex-col gap-[9.5px]'>
                <FieldLabel required>Output columns</FieldLabel>
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
                          gi < blockOutputGroups.length - 1 &&
                            'border-[var(--border)] border-b'
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
                <p className='pl-0.5 text-[var(--text-tertiary)] text-caption'>
                  Each picked field becomes its own column. Cells in the group select and delete
                  together — they share one workflow run.
                </p>
              </div>

            </>
          )}
        </div>

        <div className='flex items-center justify-end gap-2 border-[var(--border)] border-t px-2 py-3'>
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
