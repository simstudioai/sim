'use client'

import { useState } from 'react'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { X } from 'lucide-react'
import {
  Badge,
  Button,
  CollapsibleCard,
  Combobox,
  FieldDivider,
  Input,
  Label,
  Switch,
  toast,
} from '@/components/emcn'
import { ArrowLeft } from '@/components/emcn/icons'
import type { AddWorkflowGroupBodyInput } from '@/lib/api/contracts/tables'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition, WorkflowGroup, WorkflowGroupOutput } from '@/lib/table'
import { deriveOutputColumnName } from '@/lib/table/column-naming'
import type { EnrichmentConfig as EnrichmentDef } from '@/enrichments/types'
import { useAddWorkflowGroup, useUpdateWorkflowGroup } from '@/hooks/queries/tables'
import { RunSettingsSection } from '../workflow-sidebar/run-settings-section'

interface EnrichmentConfigProps {
  enrichment: EnrichmentDef
  allColumns: ColumnDefinition[]
  workspaceId: string
  tableId: string
  onBack: () => void
  onClose: () => void
  /** When set, the panel edits this existing enrichment group (pre-filled,
   *  updates instead of creating). Output columns already exist and are shown
   *  read-only. */
  existingGroup?: WorkflowGroup
}

/** Pre-fill an input's column from a same-named column (case-insensitive). */
function defaultColumnFor(
  input: EnrichmentDef['inputs'][number],
  columns: ColumnDefinition[]
): string {
  const match = columns.find(
    (c) =>
      c.name.toLowerCase() === input.id.toLowerCase() ||
      c.name.toLowerCase() === input.name.toLowerCase()
  )
  return match?.name ?? ''
}

/**
 * Config panel for a code-defined enrichment. No workflow: the user maps each
 * enrichment input to a table column; outputs are fixed by the enrichment.
 * Saving creates an `enrichment` workflow group that the table runs per row.
 */
export function EnrichmentConfig({
  enrichment,
  allColumns,
  workspaceId,
  tableId,
  onBack,
  onClose,
  existingGroup,
}: EnrichmentConfigProps) {
  const addWorkflowGroup = useAddWorkflowGroup({ workspaceId, tableId })
  const updateWorkflowGroup = useUpdateWorkflowGroup({ workspaceId, tableId })
  const isEditing = Boolean(existingGroup)

  const [inputMappings, setInputMappings] = useState<Record<string, string>>(() => {
    if (existingGroup) {
      const seed: Record<string, string> = {}
      for (const m of existingGroup.inputMappings ?? []) seed[m.inputName] = m.columnName
      return seed
    }
    const seed: Record<string, string> = {}
    for (const input of enrichment.inputs) {
      const col = defaultColumnFor(input, allColumns)
      if (col) seed[input.id] = col
    }
    return seed
  })
  // Per-output column names. Edit mode reflects the existing columns (read-only);
  // create mode seeds deduped defaults the user can rename.
  const [outputNames, setOutputNames] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    if (existingGroup) {
      for (const o of existingGroup.outputs) {
        if (o.outputId) seed[o.outputId] = o.columnName
      }
      return seed
    }
    const taken = new Set(allColumns.map((c) => c.name))
    for (const o of enrichment.outputs) {
      const colName = deriveOutputColumnName(o.name, taken)
      taken.add(colName)
      seed[o.id] = colName
    }
    return seed
  })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [autoRun, setAutoRun] = useState(() => existingGroup?.autoRun ?? false)
  const [deps, setDeps] = useState<string[]>(() => existingGroup?.dependencies?.columns ?? [])
  const [showValidation, setShowValidation] = useState(false)

  const columnOptions = allColumns.map((c) => ({ label: c.name, value: c.name }))
  const missingRequired = enrichment.inputs.some((i) => i.required && !inputMappings[i.id])
  const depsValid = !autoRun || deps.length > 0

  /** Per-output name validation (create mode only — edit mode columns exist). */
  function outputNameError(outputId: string): string | null {
    if (isEditing) return null
    const value = (outputNames[outputId] ?? '').trim()
    if (!value) return 'Required'
    const lower = value.toLowerCase()
    if (allColumns.some((c) => c.name.toLowerCase() === lower)) return 'Column already exists'
    const dup = enrichment.outputs.some(
      (o) => o.id !== outputId && (outputNames[o.id] ?? '').trim().toLowerCase() === lower
    )
    return dup ? 'Duplicate name' : null
  }
  const outputsInvalid =
    !isEditing && enrichment.outputs.some((o) => outputNameError(o.id) !== null)
  const saveDisabled =
    addWorkflowGroup.isPending || updateWorkflowGroup.isPending || !depsValid || outputsInvalid

  async function handleSave() {
    if (missingRequired || (autoRun && deps.length === 0) || outputsInvalid) {
      setShowValidation(true)
      return
    }
    const inputMappingsList = Object.entries(inputMappings)
      .filter(([, columnName]) => Boolean(columnName))
      .map(([inputName, columnName]) => ({ inputName, columnName }))

    if (existingGroup) {
      try {
        await updateWorkflowGroup.mutateAsync({
          groupId: existingGroup.id,
          name: enrichment.name,
          dependencies: { columns: deps },
          inputMappings: inputMappingsList,
          autoRun,
        })
        toast.success(`Updated "${enrichment.name}"`)
        onClose()
      } catch (err) {
        toast.error(toError(err).message)
      }
      return
    }

    const groupId = generateId()
    const taken = new Set(allColumns.map((c) => c.name))
    const outputColumns: AddWorkflowGroupBodyInput['outputColumns'] = []
    const outputs: WorkflowGroupOutput[] = []
    for (const o of enrichment.outputs) {
      const desired = (outputNames[o.id] ?? '').trim() || o.name
      const colName = deriveOutputColumnName(desired, taken)
      taken.add(colName)
      outputColumns.push({
        name: colName,
        type: o.type,
        required: false,
        unique: false,
        workflowGroupId: groupId,
      })
      outputs.push({ blockId: '', path: '', outputId: o.id, columnName: colName })
    }

    const group: WorkflowGroup = {
      id: groupId,
      workflowId: '',
      enrichmentId: enrichment.id,
      name: enrichment.name,
      type: 'enrichment',
      dependencies: { columns: deps },
      outputs,
      inputMappings: inputMappingsList,
      autoRun,
    }
    try {
      await addWorkflowGroup.mutateAsync({ group, outputColumns })
      toast.success(`Added "${enrichment.name}"`)
      onClose()
    } catch (err) {
      toast.error(toError(err).message)
    }
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
        <div className='flex min-w-0 items-center gap-1.5'>
          <Button
            variant='ghost'
            size='sm'
            onClick={onBack}
            className='!p-1 size-7 flex-none'
            aria-label='Back to enrichments'
          >
            <ArrowLeft className='size-[14px]' />
          </Button>
          <h2 className='truncate font-medium text-[var(--text-primary)] text-small'>
            {enrichment.name}
          </h2>
        </div>
        <Button
          variant='ghost'
          size='sm'
          onClick={onClose}
          className='!p-1 size-7 flex-none'
          aria-label='Close'
        >
          <X className='size-[14px]' />
        </Button>
      </div>

      <div className='flex-1 overflow-y-auto overflow-x-hidden px-2 pt-3 pb-2 [overflow-anchor:none]'>
        <div className='flex flex-col gap-[9.5px]'>
          <Label className='flex items-baseline gap-1.5 whitespace-nowrap pl-0.5'>Inputs</Label>
          {enrichment.inputs.length === 0 ? (
            <p className='pl-0.5 text-[var(--text-tertiary)] text-caption'>
              This enrichment needs no inputs.
            </p>
          ) : (
            <div className='flex flex-col gap-2'>
              {enrichment.inputs.map((input) => (
                <CollapsibleCard
                  key={input.id}
                  title={input.required ? `${input.name} *` : input.name}
                  badge={
                    <Badge variant='type' size='sm'>
                      {input.type}
                    </Badge>
                  }
                  collapsed={collapsed[input.id] ?? false}
                  onToggleCollapse={() =>
                    setCollapsed((prev) => ({ ...prev, [input.id]: !prev[input.id] }))
                  }
                >
                  <Label className='text-small'>Column</Label>
                  <Combobox
                    searchable
                    searchPlaceholder='Search columns…'
                    size='sm'
                    className='h-[32px] w-full rounded-md'
                    dropdownWidth='trigger'
                    maxHeight={240}
                    disabled={columnOptions.length === 0}
                    emptyMessage='No columns.'
                    placeholder='Select a column'
                    options={columnOptions}
                    value={inputMappings[input.id] ?? ''}
                    onChange={(columnName: string) =>
                      setInputMappings((prev) => ({ ...prev, [input.id]: columnName }))
                    }
                    error={
                      showValidation && input.required && !inputMappings[input.id]
                        ? 'Required'
                        : null
                    }
                  />
                </CollapsibleCard>
              ))}
            </div>
          )}
        </div>

        <FieldDivider />

        <div className='flex flex-col gap-[9.5px]'>
          <Label className='pl-0.5'>Output columns</Label>
          <div className='flex flex-col gap-2'>
            {enrichment.outputs.map((output) => {
              const outErr = showValidation ? outputNameError(output.id) : null
              return (
                <CollapsibleCard
                  key={output.id}
                  title={output.name}
                  badge={
                    <Badge variant='type' size='sm'>
                      {output.type}
                    </Badge>
                  }
                  collapsed={collapsed[`out:${output.id}`] ?? false}
                  onToggleCollapse={() =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [`out:${output.id}`]: !prev[`out:${output.id}`],
                    }))
                  }
                >
                  <Label className='text-small'>Column name</Label>
                  <Input
                    value={outputNames[output.id] ?? ''}
                    onChange={(e) =>
                      setOutputNames((prev) => ({ ...prev, [output.id]: e.target.value }))
                    }
                    disabled={isEditing}
                    spellCheck={false}
                    autoComplete='off'
                    className={cn(outErr && 'border-[var(--text-error)]')}
                  />
                  {outErr && <p className='text-[var(--text-error)] text-caption'>{outErr}</p>}
                </CollapsibleCard>
              )
            })}
          </div>
        </div>

        <FieldDivider />

        <div className='flex items-center justify-between pl-0.5'>
          <Label htmlFor='enrichment-auto-run'>Auto-run</Label>
          <Switch
            id='enrichment-auto-run'
            checked={autoRun}
            onCheckedChange={(v) => setAutoRun(!!v)}
          />
        </div>
        {autoRun && (
          <>
            <FieldDivider />
            <RunSettingsSection
              depOptions={allColumns}
              deps={deps}
              onChangeDeps={setDeps}
              error={showValidation && deps.length === 0 ? 'Select at least one column' : null}
            />
          </>
        )}
      </div>

      <div className='flex items-center justify-end gap-2 border-[var(--border)] border-t px-2 py-3'>
        <Button variant='default' size='sm' onClick={onClose}>
          Cancel
        </Button>
        <Button variant='primary' size='sm' onClick={handleSave} disabled={saveDisabled}>
          {isEditing ? 'Update' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
