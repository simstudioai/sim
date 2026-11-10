'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { SwitchField, TextField } from '@sim/emcn/field'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toast } from '@/lib/toast/sink'
import {
  SidePanel,
  SidePanelNote,
  SidePanelSection,
} from '@/app/(product)/_components/workspace/tables/side-panel/side-panel'
import { RunAfterField } from '@/app/(product)/_components/workspace/tables/workflow-panel/run-after-field'
import {
  type AddWorkflowGroupBodyInput,
  type ColumnDefinition,
  columnMatchesRef,
  columnTypeById,
  deriveOutputColumnName,
  type EnrichmentConfig as EnrichmentDefinition,
  getColumnId,
  useAddWorkflowGroup,
  useUpdateColumn,
  useUpdateWorkflowGroup,
  type WorkflowGroup,
  type WorkflowGroupOutput,
} from '@/platform/lib/data/tables'

const INPUT_TYPE_LABEL: Record<EnrichmentDefinition['inputs'][number]['type'], string> = {
  string: 'Text',
  number: 'Number',
  boolean: 'Boolean',
}

/** An input's column before the user picks one: the column named like it, ignoring case. */
function defaultColumnFor(
  input: EnrichmentDefinition['inputs'][number],
  columns: readonly ColumnDefinition[]
): string {
  const match = columns.find(
    (column) =>
      column.name.toLowerCase() === input.id.toLowerCase() ||
      column.name.toLowerCase() === input.name.toLowerCase()
  )
  return match ? getColumnId(match) : ''
}

interface EnrichmentConfigProps {
  enrichment: EnrichmentDefinition
  allColumns: ColumnDefinition[]
  workspaceId: string
  tableId: string
  /** Returns to the catalog; absent while editing an existing group. */
  onBack?: () => void
  onClose: () => void
  /** The group being edited: the form starts from it, and saving updates it and renames columns. */
  existingGroup?: WorkflowGroup
}

/**
 * One enrichment's settings: each input mapped to a table column, the name of each output column,
 * and when it runs. Saving creates (or updates) an `enrichment` group the table runs per row.
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
  const updateColumn = useUpdateColumn({ workspaceId, tableId })
  const isEditing = Boolean(existingGroup)

  /** An output's column while editing. Persisted refs hold a column id, or its name on old groups. */
  function outputColumn(outputId: string): ColumnDefinition | undefined {
    const ref = existingGroup?.outputs.find((output) => output.outputId === outputId)?.columnName
    return ref === undefined
      ? undefined
      : allColumns.find((column) => columnMatchesRef(column, ref))
  }

  const [inputMappings, setInputMappings] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    if (existingGroup) {
      for (const mapping of existingGroup.inputMappings ?? []) {
        const column = allColumns.find((candidate) =>
          columnMatchesRef(candidate, mapping.columnName)
        )
        seed[mapping.inputName] = column ? getColumnId(column) : mapping.columnName
      }
      return seed
    }
    for (const input of enrichment.inputs) {
      const columnId = defaultColumnFor(input, allColumns)
      if (columnId) seed[input.id] = columnId
    }
    return seed
  })
  // Output column names, editable in both modes; an edit renames the columns whose name changed.
  const [outputNames, setOutputNames] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    if (existingGroup) {
      for (const output of existingGroup.outputs) {
        if (!output.outputId) continue
        const column = allColumns.find((candidate) =>
          columnMatchesRef(candidate, output.columnName)
        )
        seed[output.outputId] = column?.name ?? output.columnName
      }
      return seed
    }
    const taken = new Set(allColumns.map((column) => column.name))
    for (const output of enrichment.outputs) {
      const columnName = deriveOutputColumnName(output.name, taken)
      taken.add(columnName)
      seed[output.id] = columnName
    }
    return seed
  })
  const [autoRun, setAutoRun] = useState(() => existingGroup?.autoRun ?? false)
  const [deps, setDeps] = useState<string[]>(() => existingGroup?.dependencies?.columns ?? [])
  const [showValidation, setShowValidation] = useState(false)

  const columnOptions = allColumns.map((column) => ({
    value: getColumnId(column),
    label: column.name,
  }))
  const missingRequired = enrichment.inputs.some(
    (input) => input.required && !inputMappings[input.id]
  )
  const depsValid = !autoRun || deps.length > 0

  /** An output name's problem, if any; its own current column's name is not a collision. */
  function outputNameError(outputId: string): string | undefined {
    const value = (outputNames[outputId] ?? '').trim()
    if (!value) return 'Required'
    const lower = value.toLowerCase()
    const ownName = outputColumn(outputId)?.name.toLowerCase()
    if (
      allColumns.some(
        (column) => column.name.toLowerCase() === lower && column.name.toLowerCase() !== ownName
      )
    )
      return 'Column already exists'
    const duplicate = enrichment.outputs.some(
      (output) =>
        output.id !== outputId && (outputNames[output.id] ?? '').trim().toLowerCase() === lower
    )
    return duplicate ? 'Duplicate name' : undefined
  }
  const outputsInvalid = enrichment.outputs.some((output) => outputNameError(output.id))
  const pending =
    addWorkflowGroup.isPending || updateWorkflowGroup.isPending || updateColumn.isPending
  const blockedReason = !depsValid
    ? 'Select at least one Run after column'
    : outputsInvalid
      ? 'Fix the output column names'
      : showValidation && missingRequired
        ? 'Map every required input'
        : undefined

  async function handleSave() {
    if (missingRequired || (autoRun && deps.length === 0) || outputsInvalid) {
      setShowValidation(true)
      return
    }
    const inputMappingsList = Object.entries(inputMappings)
      .filter(([, columnId]) => Boolean(columnId))
      .map(([inputName, columnName]) => ({ inputName, columnName }))

    if (existingGroup) {
      try {
        // The group edit lands first, so it holds even if a later rename fails; renames cascade into
        // the group's output refs on the server.
        await updateWorkflowGroup.mutateAsync({
          groupId: existingGroup.id,
          name: enrichment.name,
          dependencies: { columns: deps },
          inputMappings: inputMappingsList,
          autoRun,
        })
        for (const output of enrichment.outputs) {
          const column = outputColumn(output.id)
          const next = (outputNames[output.id] ?? '').trim()
          if (column && next && next !== column.name) {
            await updateColumn.mutateAsync({
              columnName: getColumnId(column),
              updates: { name: next },
            })
          }
        }
        toast.success(`Updated "${enrichment.name}"`)
        onClose()
      } catch (error) {
        toast.error(toError(error).message)
      }
      return
    }

    const groupId = generateId()
    const taken = new Set(allColumns.map((column) => column.name))
    const outputColumns: AddWorkflowGroupBodyInput['outputColumns'] = []
    const outputs: WorkflowGroupOutput[] = []
    for (const output of enrichment.outputs) {
      const desired = (outputNames[output.id] ?? '').trim() || output.name
      const columnName = deriveOutputColumnName(desired, taken)
      taken.add(columnName)
      outputColumns.push({
        name: columnName,
        type: output.type,
        required: false,
        unique: false,
        workflowGroupId: groupId,
      })
      outputs.push({ blockId: '', path: '', outputId: output.id, columnName })
    }
    try {
      await addWorkflowGroup.mutateAsync({
        group: {
          id: groupId,
          workflowId: '',
          enrichmentId: enrichment.id,
          name: enrichment.name,
          type: 'enrichment',
          dependencies: { columns: deps },
          outputs,
          inputMappings: inputMappingsList,
          autoRun,
        },
        outputColumns,
      })
      toast.success(`Added "${enrichment.name}"`)
      onClose()
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  return (
    <SidePanel
      title={enrichment.name}
      onClose={onClose}
      back={onBack ? { label: 'Back to enrichments', onBack } : undefined}
      footer={
        <>
          <Button variant='quiet' size='compact' onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant='primary'
            size='compact'
            onClick={() => void handleSave()}
            disabled={pending || Boolean(blockedReason)}
            disabledReason={pending ? undefined : blockedReason}
          >
            {pending ? 'Saving…' : isEditing ? 'Save' : 'Add enrichment'}
          </Button>
        </>
      }
    >
      <SidePanelSection title='Inputs'>
        {enrichment.inputs.length === 0 ? (
          <SidePanelNote>This enrichment needs no inputs.</SidePanelNote>
        ) : (
          enrichment.inputs.map((input) => (
            <SearchableSelect
              key={input.id}
              label={input.required ? input.name : `${input.name} (optional)`}
              hint={INPUT_TYPE_LABEL[input.type]}
              options={columnOptions}
              value={inputMappings[input.id] || null}
              onValueChange={(columnId) =>
                setInputMappings((current) => ({ ...current, [input.id]: columnId ?? '' }))
              }
              placeholder='Select a column'
              searchLabel='Search columns'
              disabled={columnOptions.length === 0}
              disabledReason={columnOptions.length === 0 ? 'No columns' : undefined}
              error={
                showValidation && input.required && !inputMappings[input.id]
                  ? 'Required'
                  : undefined
              }
            />
          ))
        )}
      </SidePanelSection>

      <SidePanelSection title='Output columns'>
        {enrichment.outputs.map((output) => (
          <TextField
            key={output.id}
            label={output.name}
            hint={columnTypeById(output.type).label}
            placeholder='Column name'
            autoComplete='off'
            value={outputNames[output.id] ?? ''}
            onChange={(value) => setOutputNames((current) => ({ ...current, [output.id]: value }))}
            error={outputNameError(output.id)}
          />
        ))}
      </SidePanelSection>

      <SidePanelSection>
        <SwitchField label='Auto-run' checked={autoRun} onCheckedChange={setAutoRun} />
        {autoRun && (
          <RunAfterField
            columns={allColumns}
            value={deps}
            onChange={setDeps}
            error={showValidation && deps.length === 0 ? 'Select at least one column' : undefined}
          />
        )}
      </SidePanelSection>
    </SidePanel>
  )
}
