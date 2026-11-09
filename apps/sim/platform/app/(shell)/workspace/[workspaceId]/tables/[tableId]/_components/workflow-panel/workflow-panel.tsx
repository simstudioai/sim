'use client'

import { useMemo, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { SwitchField, TextField } from '@sim/emcn/field'
import { ListField } from '@sim/emcn/field/list-field'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  SidePanel,
  SidePanelNote,
  SidePanelSection,
} from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/side-panel/side-panel'
import { InputMappingFields } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/workflow-panel/input-mapping-fields'
import {
  blockOutputGroups,
  encodeOutputValue,
  orderPickedOutputs,
  previewBlocks,
  startBlockInputs,
} from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/workflow-panel/outputs'
import { RunAfterField } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/workflow-panel/run-after-field'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/workflow-panel/workflow-panel.module.css'
import { platformUrl } from '@/platform/lib/data/base-path'
import {
  type AddWorkflowGroupBodyInput,
  type ColumnDefinition,
  columnTypeForLeaf,
  deriveOutputColumnName,
  findValidationIssue,
  getColumnId,
  isValidationError,
  type UpdateWorkflowGroupBodyInput,
  useAddWorkflowGroup,
  useUpdateColumn,
  useUpdateWorkflowGroup,
  type WorkflowGroup,
  type WorkflowGroupDependencies,
  type WorkflowGroupInputMapping,
  type WorkflowGroupOutput,
  type WorkflowMetadata,
} from '@/platform/lib/data/tables'
import { useDeployedWorkflowState } from '@/platform/lib/data/workflows'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { toast } from '@/platform/shared/toast'

/**
 * A workflow group the user built (`manual`) or one spawned from a shared enrichment template
 * (`enrichment`). Enrichment groups keep their workflow fixed, hide the open-workflow action and
 * offer a way back to the enrichments list.
 */
type WorkflowSidebarKind = 'manual' | 'enrichment'

/**
 * What the workflow panel configures:
 * - `create`: a new workflow group, from the new-column menu's Workflow item (`manual`) or an
 *   enrichment template (`enrichment`, with the template's workflow chosen and locked).
 * - `edit-group`: an existing group as a whole (workflow, outputs, dependencies, inputs, auto-run).
 * - `edit-output`: one output column of a group: which block output it reads, and its name.
 */
export type WorkflowConfig =
  | {
      mode: 'create'
      kind: WorkflowSidebarKind
      proposedName: string
      /** Pre-selected (and locked) workflow id for an enrichment create. */
      workflowId?: string
      /** The title of an enrichment create: the enrichment's name. */
      enrichmentName?: string
    }
  | { mode: 'edit-group'; groupId: string }
  | { mode: 'edit-output'; columnName: string }

interface WorkflowPanelProps {
  config: WorkflowConfig
  onClose: () => void
  /** Every column of the table: the Run after choices, input mappings and name collisions. */
  allColumns: ColumnDefinition[]
  workflowGroups: WorkflowGroup[]
  workflows: WorkflowMetadata[] | undefined
  workspaceId: string
  tableId: string
  /** Told of an output column's rename, so the grid can move its local width and order keys. */
  onColumnRename?: (oldName: string, newName: string) => void
  /** Shown for an enrichment group: returns to the enrichments list. */
  onBack?: () => void
}

const TITLE_BY_MODE = {
  create: 'Add workflow',
  'edit-group': 'Configure workflow',
  'edit-output': 'Configure output column',
} as const

function configKey(config: WorkflowConfig): string {
  switch (config.mode) {
    case 'create':
      return `create:${config.kind}:${config.workflowId ?? ''}:${config.proposedName}`
    case 'edit-group':
      return `edit-group:${config.groupId}`
    case 'edit-output':
      return `edit-output:${config.columnName}`
  }
}

/**
 * The table's workflow panel: create a workflow group, edit one, or remap a single output column.
 * Its form state seeds from props, so opening another group or column starts a fresh form.
 */
export function WorkflowPanel(props: WorkflowPanelProps) {
  return (
    <WorkflowPanelForm
      key={configKey(props.config)}
      config={props.config}
      onClose={props.onClose}
      allColumns={props.allColumns}
      workflowGroups={props.workflowGroups}
      workflows={props.workflows}
      workspaceId={props.workspaceId}
      tableId={props.tableId}
      onColumnRename={props.onColumnRename}
      onBack={props.onBack}
    />
  )
}

function WorkflowPanelForm({
  config,
  onClose,
  allColumns,
  workflowGroups,
  workflows,
  workspaceId,
  tableId,
  onColumnRename,
  onBack,
}: WorkflowPanelProps) {
  const updateColumn = useUpdateColumn({ workspaceId, tableId })
  const addWorkflowGroup = useAddWorkflowGroup({ workspaceId, tableId })
  const updateWorkflowGroup = useUpdateWorkflowGroup({ workspaceId, tableId })

  const existingColumn =
    config.mode === 'edit-output'
      ? (allColumns.find((column) => getColumnId(column) === config.columnName) ?? null)
      : null
  const existingGroup: WorkflowGroup | undefined =
    config.mode === 'edit-group'
      ? workflowGroups.find((group) => group.id === config.groupId)
      : existingColumn?.workflowGroupId
        ? workflowGroups.find((group) => group.id === existingColumn.workflowGroupId)
        : undefined

  const kind: WorkflowSidebarKind =
    config.mode === 'create' ? config.kind : (existingGroup?.type ?? 'manual')
  const isEnrichment = kind === 'enrichment'
  const isEditOutputMode = config.mode === 'edit-output'

  // Dependencies must sit left of the group: of the edited column, or of the group's leftmost output
  // column. A new group lands at the right edge, so every column qualifies.
  const anchorIndex = (() => {
    if (config.mode === 'edit-output') {
      const index = allColumns.findIndex((column) => getColumnId(column) === config.columnName)
      return index === -1 ? allColumns.length : index
    }
    if (config.mode === 'edit-group' && existingGroup) {
      const index = allColumns.findIndex((column) => column.workflowGroupId === existingGroup.id)
      return index === -1 ? allColumns.length : index
    }
    return allColumns.length
  })()
  const leftColumns =
    anchorIndex >= allColumns.length ? allColumns : allColumns.slice(0, anchorIndex)
  const ownOutputIds = new Set(existingGroup?.outputs.map((output) => output.columnName) ?? [])
  const depOptions = leftColumns.filter((column) => !ownOutputIds.has(getColumnId(column)))

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    () => existingGroup?.workflowId ?? (config.mode === 'create' ? (config.workflowId ?? '') : '')
  )
  const [inputMappings, setInputMappings] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    for (const mapping of existingGroup?.inputMappings ?? []) {
      seed[mapping.inputName] = mapping.columnName
    }
    return seed
  })
  const [inputMappingsHydrated, setInputMappingsHydrated] = useState(false)
  // Additional fields open by themselves only when the group already maps some inputs.
  const [showAdvanced, setShowAdvanced] = useState(
    () => (existingGroup?.inputMappings?.length ?? 0) > 0
  )
  // A group that predates auto-run kept running on its own, so a missing flag reads as on; a new
  // group starts off and the user opts in.
  const [autoRun, setAutoRun] = useState(() =>
    existingGroup ? existingGroup.autoRun !== false : false
  )
  const [deps, setDeps] = useState<string[]>(() => existingGroup?.dependencies?.columns ?? [])
  // Encoded `blockId::path`, seeded once the workflow's blocks load.
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([])
  const [outputsHydrated, setOutputsHydrated] = useState(false)
  const [columnNameInput, setColumnNameInput] = useState(
    () => existingColumn?.name ?? (config.mode === 'create' ? config.proposedName : '')
  )
  const [showValidation, setShowValidation] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const workflowState = useDeployedWorkflowState(selectedWorkflowId || null)
  const deployedState = workflowState.data
  const startInputs = useMemo(() => startBlockInputs(deployedState), [deployedState])
  const outputGroups = useMemo(() => blockOutputGroups(deployedState), [deployedState])
  const outputOptions = useMemo(
    () =>
      outputGroups.flatMap((group) =>
        group.paths.map((path) => ({
          value: encodeOutputValue(group.blockId, path),
          label: `${group.blockName} · ${path}`,
        }))
      ),
    [outputGroups]
  )

  // Once the blocks load, select the group's persisted outputs that still exist. A stale one (its
  // block or path removed) drops out, and the user picks again before saving.
  if (!outputsHydrated && existingGroup?.outputs.length && outputGroups.length > 0) {
    const persisted =
      config.mode === 'edit-output' && existingColumn
        ? existingGroup.outputs.filter(
            (output) => output.columnName === getColumnId(existingColumn)
          )
        : existingGroup.outputs
    setSelectedOutputs(
      persisted
        .filter((output) =>
          outputGroups.some(
            (group) => group.blockId === output.blockId && group.paths.includes(output.path)
          )
        )
        .map((output) => encodeOutputValue(output.blockId, output.path))
    )
    setOutputsHydrated(true)
  }

  // Once the Start block's fields load, map each unmapped field to the column of the same name.
  // Runs once per workflow and never replaces a persisted or picked mapping.
  if (!inputMappingsHydrated && startInputs.length > 0) {
    const idByColumnName = new Map(depOptions.map((column) => [column.name, getColumnId(column)]))
    const next = { ...inputMappings }
    let changed = false
    for (const field of startInputs) {
      if (!field.name || next[field.name]) continue
      const columnId = idByColumnName.get(field.name)
      if (columnId) {
        next[field.name] = columnId
        changed = true
      }
    }
    if (changed) setInputMappings(next)
    setInputMappingsHydrated(true)
  }

  function selectWorkflow(workflowId: string) {
    if (workflowId === selectedWorkflowId) return
    setSelectedWorkflowId(workflowId)
    // Outputs and input fields belong to the workflow they were read from.
    setSelectedOutputs([])
    setInputMappingsHydrated(false)
  }

  async function handleSave() {
    const trimmedName = columnNameInput.trim()
    if (
      !selectedWorkflowId ||
      selectedOutputs.length === 0 ||
      (isEditOutputMode && !trimmedName) ||
      (autoRun && deps.length === 0)
    ) {
      setShowValidation(true)
      return
    }

    try {
      const orderedOutputs = orderPickedOutputs(selectedOutputs, deployedState)
      const dependencies: WorkflowGroupDependencies = { columns: deps }
      const inputMappingsList: WorkflowGroupInputMapping[] = Object.entries(inputMappings)
        .filter(([, columnId]) => Boolean(columnId))
        .map(([inputName, columnName]) => ({ inputName, columnName }))

      if (existingGroup && isEditOutputMode && existingColumn) {
        const newPick = orderedOutputs[0]
        if (!newPick) throw new Error('Pick an output')
        const renamed = trimmedName !== existingColumn.name
        if (renamed) {
          await updateColumn.mutateAsync({
            columnName: existingColumn.name,
            updates: { name: trimmedName },
          })
          onColumnRename?.(existingColumn.name, trimmedName)
        }
        // The server swaps the mapping and clears the column, so the next run fills it from the new
        // source.
        const targetColumnName = renamed ? trimmedName : existingColumn.name
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
      } else if (existingGroup) {
        const taken = new Set(allColumns.map((column) => column.name))
        const fullOutputs: WorkflowGroupOutput[] = []
        const newOutputColumns: NonNullable<UpdateWorkflowGroupBodyInput['newOutputColumns']> = []
        for (const output of orderedOutputs) {
          const kept = existingGroup.outputs.find(
            (existing) => existing.blockId === output.blockId && existing.path === output.path
          )
          if (kept) {
            fullOutputs.push(kept)
            continue
          }
          const columnName = deriveOutputColumnName(output.path, taken)
          taken.add(columnName)
          fullOutputs.push({ blockId: output.blockId, path: output.path, columnName })
          newOutputColumns.push({
            name: columnName,
            type: columnTypeForLeaf(output.leafType),
            required: false,
            unique: false,
            workflowGroupId: existingGroup.id,
          })
        }
        await updateWorkflowGroup.mutateAsync({
          groupId: existingGroup.id,
          workflowId: selectedWorkflowId,
          name: existingGroup.name,
          dependencies,
          outputs: fullOutputs,
          ...(newOutputColumns.length > 0 ? { newOutputColumns } : {}),
          inputMappings: inputMappingsList,
          autoRun,
        })
        toast.success(`Saved "${existingGroup.name ?? 'Workflow'}"`)
      } else {
        const groupId = generateId()
        const taken = new Set(allColumns.map((column) => column.name))
        const outputColumns: AddWorkflowGroupBodyInput['outputColumns'] = []
        const groupOutputs: WorkflowGroupOutput[] = []
        for (const output of orderedOutputs) {
          const columnName = deriveOutputColumnName(output.path, taken)
          taken.add(columnName)
          outputColumns.push({
            name: columnName,
            type: columnTypeForLeaf(output.leafType),
            required: false,
            unique: false,
            workflowGroupId: groupId,
          })
          groupOutputs.push({ blockId: output.blockId, path: output.path, columnName })
        }
        const workflowName =
          workflows?.find((workflow) => workflow.id === selectedWorkflowId)?.name ?? 'Workflow'
        await addWorkflowGroup.mutateAsync({
          group: {
            id: groupId,
            workflowId: selectedWorkflowId,
            name: workflowName,
            type: kind,
            dependencies,
            outputs: groupOutputs,
            inputMappings: inputMappingsList,
            autoRun,
          },
          outputColumns,
        })
        toast.success(`Added "${workflowName}"`)
      }
      onClose()
    } catch (error) {
      // Other failures are already raised by the mutation's own notice.
      if (!isValidationError(error)) return
      const nameIssue =
        findValidationIssue(error, ['updates', 'name']) ??
        findValidationIssue(error, ['name']) ??
        findValidationIssue(error, ['columnName'])
      if (nameIssue) setNameError(nameIssue.message)
      else toast.error(toError(error).message)
    }
  }

  const pending =
    addWorkflowGroup.isPending || updateWorkflowGroup.isPending || updateColumn.isPending
  // Auto-run fires only once a dependency fills, so it needs at least one.
  const depsValid = !autoRun || deps.length > 0
  const title =
    config.mode === 'create' && config.kind === 'enrichment' && config.enrichmentName
      ? config.enrichmentName
      : TITLE_BY_MODE[config.mode]

  const workflowOptions =
    workflows
      ?.filter((workflow) => workflow.isDeployed)
      .map((workflow) => ({ value: workflow.id, label: workflow.name })) ?? []
  const selectedWorkflowListed = workflowOptions.some(
    (option) => option.value === selectedWorkflowId
  )
  const workflowLocked = isEditOutputMode || isEnrichment
  const outputsUnavailable = workflowState.isLoading || outputGroups.length === 0
  const outputsUnavailableReason = !selectedWorkflowId
    ? 'Select a workflow first'
    : workflowState.isLoading
      ? undefined
      : 'No outputs found'
  const outputError =
    showValidation && selectedWorkflowId && selectedOutputs.length === 0
      ? isEditOutputMode
        ? 'Pick an output'
        : 'Pick at least one output column'
      : undefined
  const columnNameError =
    showValidation && !columnNameInput.trim() ? 'Column name is required' : (nameError ?? undefined)

  return (
    <SidePanel
      title={title}
      onClose={onClose}
      back={isEnrichment && onBack ? { label: 'Back to enrichments', onBack } : undefined}
      footer={
        <>
          <Button variant='quiet' size='compact' onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant='primary'
            size='compact'
            onClick={() => void handleSave()}
            disabled={pending || !depsValid}
            disabledReason={
              !pending && !depsValid ? 'Select at least one Run after column' : undefined
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {isEditOutputMode && (
        <SidePanelSection>
          <TextField
            label='Column name'
            placeholder='Column name'
            autoComplete='off'
            value={columnNameInput}
            onChange={(value) => {
              setColumnNameInput(value)
              if (nameError) setNameError(null)
            }}
            error={columnNameError}
          />
        </SidePanelSection>
      )}

      {selectedWorkflowId && !workflowState.isLoading && (
        <SidePanelSection>
          {deployedState ? (
            <ListField
              label='Workflow preview'
              groups={[{ id: 'blocks', items: previewBlocks(deployedState) }]}
            />
          ) : (
            <SidePanelNote>Unable to load the workflow preview</SidePanelNote>
          )}
          {deployedState && !isEnrichment && (
            <span className={styles.previewOpen}>
              <Button
                variant='quiet'
                size='compact'
                trailingIcon='I037'
                onClick={() =>
                  window.open(
                    platformUrl(
                      `${workspacePath(workspaceId, 'workflows')}/${encodeURIComponent(selectedWorkflowId)}`
                    ),
                    '_blank',
                    'noopener,noreferrer'
                  )
                }
              >
                Open workflow
              </Button>
            </span>
          )}
        </SidePanelSection>
      )}

      <SidePanelSection>
        <SearchableSelect
          label='Workflow'
          options={workflowOptions}
          value={selectedWorkflowId || null}
          selectedLabel={
            selectedWorkflowId && !selectedWorkflowListed
              ? workflows?.find((workflow) => workflow.id === selectedWorkflowId)?.name
              : undefined
          }
          onValueChange={(workflowId) => selectWorkflow(workflowId ?? '')}
          placeholder='Select a workflow'
          searchLabel='Search workflows'
          disabled={workflowLocked || workflowOptions.length === 0}
          disabledReason={
            !workflowLocked && workflowOptions.length === 0
              ? 'No deployed workflows available'
              : undefined
          }
          error={showValidation && !selectedWorkflowId ? 'Select a workflow' : undefined}
        />
      </SidePanelSection>

      <SidePanelSection>
        {isEditOutputMode ? (
          <SearchableSelect
            label='Output'
            options={outputOptions}
            value={selectedOutputs[0] ?? null}
            onValueChange={(value) => setSelectedOutputs(value ? [value] : [])}
            placeholder='Select an output'
            searchLabel='Search outputs'
            disabled={outputsUnavailable}
            disabledReason={outputsUnavailable ? outputsUnavailableReason : undefined}
            error={outputError}
          />
        ) : (
          <MultiSelect
            label='Output columns'
            options={outputOptions}
            value={selectedOutputs}
            onValueChange={setSelectedOutputs}
            placeholder='Select outputs'
            searchLabel='Search outputs'
            disabled={outputsUnavailable}
            disabledReason={outputsUnavailable ? outputsUnavailableReason : undefined}
            error={outputError}
          />
        )}
      </SidePanelSection>

      {!isEditOutputMode && (
        <SidePanelSection>
          <SwitchField label='Auto-run workflow' checked={autoRun} onCheckedChange={setAutoRun} />
          {autoRun && (
            <RunAfterField
              columns={depOptions}
              value={deps}
              onChange={setDeps}
              error={showValidation && deps.length === 0 ? 'Select at least one column' : undefined}
            />
          )}
        </SidePanelSection>
      )}

      {!isEditOutputMode && selectedWorkflowId && (
        <Disclosure
          label={showAdvanced ? 'Hide additional fields' : 'Show additional fields'}
          open={showAdvanced}
          onOpenChange={setShowAdvanced}
          chevron
        >
          <div className={styles.disclosed}>
            <InputMappingFields
              inputFields={startInputs}
              columns={depOptions}
              value={inputMappings}
              onChange={setInputMappings}
            />
          </div>
        </Disclosure>
      )}
    </SidePanel>
  )
}
