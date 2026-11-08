'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { generateId } from '@sim/utils/id'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { EntryCard } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/entry-card/entry-card'
import { formatDisplayText } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import {
  getActiveWorkflowSearchHighlight,
  getWorkflowSearchLabelHighlight,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import { ReferenceField } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/reference-field/reference-field'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/variables-input/variables-input.module.css'
import {
  type SubBlockConfig,
  useAccessibleReferencePrefixes,
  useSubBlockInput,
  useSubBlockValue,
  useWorkflowRegistry,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'
import { useVariablesStore } from '@/platform/lib/data/workflow-editor/structured'

interface VariableAssignment {
  id: string
  variableId?: string
  variableName: string
  type: 'string' | 'plain' | 'number' | 'boolean' | 'object' | 'array' | 'json'
  value: string
  isExisting: boolean
}

interface VariablesInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

const DEFAULT_ASSIGNMENT: Omit<VariableAssignment, 'id'> = {
  variableName: '',
  type: 'string',
  value: '',
  isExisting: false,
}

const BOOLEAN_OPTIONS = [
  { label: 'true', value: 'true' },
  { label: 'false', value: 'false' },
]

/** Values the boolean picker can show; anything else, such as a reference, needs the text field. */
const BOOLEAN_LITERALS = new Set(['', 'true', 'false'])

const OBJECT_PLACEHOLDER = '{\n  "key": "value"\n}'
const ARRAY_PLACEHOLDER = '[\n  1, 2, 3\n]'

/** Reads the stored assignments, which an imported workflow may hold as a JSON string. */
function parseVariableAssignments(value: unknown): VariableAssignment[] {
  if (!value) return []
  if (Array.isArray(value)) return value as VariableAssignment[]
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed as VariableAssignment[]
      } catch {
        return []
      }
    }
  }
  return []
}

/**
 * The Variables block's assignments: each picks one of the workflow's variables (a variable goes
 * to one assignment at a time) and sets its value, typed by the variable, with references after
 * `<`. Assignments to a deleted variable drop once the workflow's variables have loaded.
 */
export function VariablesInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: VariablesInputProps) {
  const baseId = useId()
  const activeSearchTarget = useActiveSearchTarget()
  const { workflowId } = useWorkflowScope()
  const [storeValue, setStoreValue] = useSubBlockValue<VariableAssignment[]>(blockId, subBlockId)
  const workflowVariables = useVariablesStore((state) => state.variables)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  /**
   * Stale assignments are purged only once the variables store holds this workflow's variables:
   * before that, every assignment would look orphaned and the purge would erase them all.
   */
  const isHydratedForWorkflow = useWorkflowRegistry(
    (state) => state.hydration.phase === 'ready' && state.hydration.workflowId === workflowId
  )
  const controllerConfig = useMemo<SubBlockConfig>(
    () => ({ id: subBlockId, type: 'variables-input' }),
    [subBlockId]
  )
  const controller = useSubBlockInput({
    blockId,
    subBlockId,
    config: controllerConfig,
    isPreview,
    disabled,
  })
  const [collapsedAssignments, setCollapsedAssignments] = useState<Record<string, boolean>>({})
  const [manualBooleanModes, setManualBooleanModes] = useState<Record<string, boolean>>({})

  const currentWorkflowVariables = Object.values(workflowVariables).filter(
    (variable) => variable.workflowId === workflowId
  )
  const assignments = parseVariableAssignments(isPreview ? previewValue : storeValue)
  const isReadOnly = isPreview || disabled

  const availableVariablesFor = (assignmentId: string) => {
    const takenByOthers = new Set(
      assignments
        .filter((assignment) => assignment.id !== assignmentId)
        .map((assignment) => assignment.variableId)
        .filter((id): id is string => Boolean(id))
    )
    return currentWorkflowVariables.filter((variable) => !takenByOthers.has(variable.id))
  }

  const hasNoWorkflowVariables = currentWorkflowVariables.length === 0
  const allVariablesAssigned = !hasNoWorkflowVariables && availableVariablesFor('new').length === 0

  useEffect(() => {
    if (!isReadOnly && assignments.length === 0 && currentWorkflowVariables.length > 0) {
      setStoreValue([{ ...DEFAULT_ASSIGNMENT, id: generateId() }])
    }
  }, [currentWorkflowVariables.length, isReadOnly, assignments.length, setStoreValue])

  useEffect(() => {
    if (isReadOnly || assignments.length === 0 || !isHydratedForWorkflow) return
    const currentVariableIds = new Set(currentWorkflowVariables.map((variable) => variable.id))
    const validAssignments = assignments.filter(
      (assignment) => !assignment.variableId || currentVariableIds.has(assignment.variableId)
    )
    if (currentWorkflowVariables.length === 0) {
      setStoreValue([])
    } else if (validAssignments.length !== assignments.length) {
      setStoreValue(validAssignments)
    }
  }, [currentWorkflowVariables, assignments, isReadOnly, isHydratedForWorkflow, setStoreValue])

  const searchedIndex =
    activeSearchTarget?.subBlockId === subBlockId ? activeSearchTarget.valuePath[0] : undefined
  const searchedAssignment =
    typeof searchedIndex === 'number' ? assignments[searchedIndex] : undefined
  if (searchedAssignment && collapsedAssignments[searchedAssignment.id]) {
    setCollapsedAssignments((prev) => ({ ...prev, [searchedAssignment.id]: false }))
  }

  const addAssignment = () => {
    if (isReadOnly || allVariablesAssigned) return
    setStoreValue([...assignments, { ...DEFAULT_ASSIGNMENT, id: generateId() }])
  }

  const removeAssignment = (id: string) => {
    if (isReadOnly) return
    if (assignments.length === 1) {
      setStoreValue([{ ...DEFAULT_ASSIGNMENT, id: generateId() }])
      return
    }
    setStoreValue(assignments.filter((assignment) => assignment.id !== id))
  }

  const updateAssignment = (id: string, updates: Partial<VariableAssignment>) => {
    if (isReadOnly) return
    setStoreValue(
      assignments.map((assignment) =>
        assignment.id === id ? { ...assignment, ...updates } : assignment
      )
    )
  }

  const selectVariable = (assignmentId: string, variableId: string) => {
    const selected = currentWorkflowVariables.find((variable) => variable.id === variableId)
    if (!selected) return
    updateAssignment(assignmentId, {
      variableId: selected.id,
      variableName: selected.name,
      type: selected.type,
      isExisting: true,
    })
  }

  if (isPreview && assignments.length === 0) {
    return (
      <div className={styles.note}>
        <span className={styles.noteTitle} data-type='T060'>
          No variable assignments defined
        </span>
        <span data-type='T052'>Add variables in the Variables panel to get started</span>
      </div>
    )
  }

  if (!isPreview && hasNoWorkflowVariables && assignments.length === 0) {
    return (
      <p className={styles.note} data-type='T052'>
        No variables available
      </p>
    )
  }

  return (
    <div className={styles.entries}>
      {assignments.map((assignment, index) => {
        const entryId = `${baseId}-${assignment.id}`
        const collapsed = collapsedAssignments[assignment.id] ?? false
        const variableLabel = assignment.variableName
        const variableLabelHighlight = getWorkflowSearchLabelHighlight({
          activeSearchTarget,
          blockId,
          subBlockId,
          valuePath: [index, 'variableName'],
          label: variableLabel,
        })
        const isManualBoolean =
          assignment.type === 'boolean' &&
          (manualBooleanModes[assignment.id] ?? !BOOLEAN_LITERALS.has(assignment.value ?? ''))
        const valueSearchHighlight = getActiveWorkflowSearchHighlight({
          activeSearchTarget,
          blockId,
          subBlockId,
          valuePath: [index, 'value'],
        })
        const setValue = (next: string) => updateAssignment(assignment.id, { value: next })
        const usesBooleanPicker = assignment.type === 'boolean' && !isManualBoolean

        return (
          <EntryCard
            key={assignment.id}
            label={`Variable ${index + 1}`}
            title={
              variableLabel
                ? formatDisplayText(variableLabel, {
                    workflowSearchHighlight: variableLabelHighlight,
                  })
                : `Variable ${index + 1}`
            }
            typeTag={variableLabel ? assignment.type : undefined}
            collapsed={collapsed}
            onToggle={() =>
              setCollapsedAssignments((prev) => ({ ...prev, [assignment.id]: !collapsed }))
            }
            actions={
              <>
                <IconButton
                  label='Add variable'
                  icon='I074'
                  size='compact'
                  disabled={isReadOnly || allVariablesAssigned}
                  onClick={addAssignment}
                />
                <IconButton
                  label='Delete variable'
                  icon='I105'
                  size='compact'
                  disabled={isReadOnly}
                  onClick={() => removeAssignment(assignment.id)}
                />
              </>
            }
          >
            <SearchableSelect
              label='Variable'
              searchLabel='Search variables'
              placeholder='Select a variable...'
              options={availableVariablesFor(assignment.id).map((variable) => ({
                label: variable.name,
                value: variable.id,
              }))}
              value={assignment.variableId || null}
              selectedLabel={assignment.variableId ? variableLabel || undefined : undefined}
              onValueChange={(next) => {
                if (next) selectVariable(assignment.id, next)
              }}
              disabled={isReadOnly}
            />
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label
                  className={styles.label}
                  data-type='T059'
                  htmlFor={usesBooleanPicker ? undefined : `${entryId}-value`}
                >
                  Value
                </label>
                {assignment.type === 'boolean' && (
                  <Button
                    variant='quiet'
                    size='compact'
                    aria-label={isManualBoolean ? 'Switch to selector' : 'Switch to manual value'}
                    disabled={isReadOnly}
                    onClick={() =>
                      setManualBooleanModes((prev) => ({
                        ...prev,
                        [assignment.id]: !isManualBoolean,
                      }))
                    }
                  >
                    {isManualBoolean ? 'Selector' : 'Manual'}
                  </Button>
                )}
              </div>
              {usesBooleanPicker ? (
                <SearchableSelect
                  label='Value'
                  labelHidden
                  searchLabel='Search values'
                  placeholder='Select value'
                  options={BOOLEAN_OPTIONS}
                  value={assignment.value || null}
                  onValueChange={(next) => {
                    if (next !== null && !isReadOnly) setValue(next)
                  }}
                  disabled={isReadOnly}
                />
              ) : (
                <ReferenceField
                  id={`${entryId}-value`}
                  label='Value'
                  blockId={blockId}
                  value={assignment.value || ''}
                  onChange={setValue}
                  controller={controller}
                  fieldKey={assignment.id}
                  code={assignment.type === 'object' || assignment.type === 'array'}
                  placeholder={
                    assignment.type === 'object'
                      ? OBJECT_PLACEHOLDER
                      : assignment.type === 'array'
                        ? ARRAY_PLACEHOLDER
                        : `${assignment.type} value`
                  }
                  disabled={isReadOnly}
                  accessiblePrefixes={accessiblePrefixes}
                  searchHighlight={valueSearchHighlight}
                />
              )}
            </div>
          </EntryCard>
        )
      })}
    </div>
  )
}
