'use client'

import { type KeyboardEvent, useId, useMemo, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { FieldFrame, fieldDescription } from '@sim/emcn/field'
import { Input } from '@sim/emcn/field/inputs'
import { Select } from '@sim/emcn/picker/select'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { CodeField } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/code-field/code-field'
import { highlightSyntax } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/code-field/highlight'
import { EntryCard } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/entry-card/entry-card'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/variables/variables-panel.module.css'
import {
  type Variable,
  type VariableType,
  validateName,
} from '@/platform/lib/data/workflow-deploy/variables'
import {
  isWorkflowEffectivelyLocked,
  useCollaborativeWorkflow,
  useFolderMap,
  useUserPermissionsContext,
  useVariablesStore,
  useWorkflowMap,
  useWorkflowRegistry,
  useWorkflowScope,
} from '@/platform/lib/data/workflows'

type EditableVariableType = Exclude<VariableType, 'string'>

const TYPE_OPTIONS: readonly { label: string; value: EditableVariableType }[] = [
  { label: 'Plain', value: 'plain' },
  { label: 'Number', value: 'number' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Object', value: 'object' },
  { label: 'Array', value: 'array' },
]

const EMPTY_NAME_ERROR = 'Variable name cannot be empty'
const DUPLICATE_NAME_ERROR = 'Two variables cannot have the same name'

const PLACEHOLDERS = {
  name: 'variableName',
  number: '42',
  boolean: 'true',
  plain: 'Plain text value',
  object: '{\n  "key": "value"\n}',
  array: '[\n  1, 2, 3\n]',
} as const

const highlightJson = (code: string) => highlightSyntax(code, 'json')

/** The stored value as the editor shows it: strings as typed, anything else as JSON. */
function displayValue(value: unknown): string {
  if (value === '') return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Enter commits a name the way leaving the field does. */
function blurOnEnter(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.target.blur()
}

interface VariableValueFieldProps {
  variable: Variable
  readOnly: boolean
  onChange: (value: string) => void
}

/** A JSON editor for objects and arrays, a text field for every other type, as in legacy. */
function VariableValueField({ variable, readOnly, onChange }: VariableValueFieldProps) {
  const id = useId()
  const value = displayValue(variable.value)
  if (variable.type === 'object' || variable.type === 'array') {
    return (
      <FieldFrame label='Value'>
        <CodeField
          value={value}
          onValueChange={onChange}
          highlight={highlightJson}
          label='Value'
          placeholder={variable.type === 'object' ? PLACEHOLDERS.object : PLACEHOLDERS.array}
          disabled={readOnly}
        />
      </FieldFrame>
    )
  }
  return (
    <FieldFrame id={id} label='Value'>
      <Input
        id={id}
        label='Value'
        name='value'
        autoComplete='off'
        value={value}
        onChange={onChange}
        disabled={readOnly}
        placeholder={
          variable.type === 'number'
            ? PLACEHOLDERS.number
            : variable.type === 'boolean'
              ? PLACEHOLDERS.boolean
              : PLACEHOLDERS.plain
        }
      />
    </FieldFrame>
  )
}

interface VariableEntryProps {
  variable: Variable
  index: number
  readOnly: boolean
  collapsed: boolean
  localName: string | undefined
  nameError: string | undefined
  onToggle: () => void
  onRemove: () => void
  onNameChange: (name: string) => void
  onNameCommit: () => void
  onUpdate: (field: 'value' | 'type', value: string) => void
}

function VariableEntry({
  variable,
  index,
  readOnly,
  collapsed,
  localName,
  nameError,
  onToggle,
  onRemove,
  onNameChange,
  onNameCommit,
  onUpdate,
}: VariableEntryProps) {
  const nameId = useId()
  const fallbackLabel = `Variable ${index + 1}`
  return (
    <EntryCard
      label={variable.name || fallbackLabel}
      title={variable.name || fallbackLabel}
      typeTag={variable.name ? variable.type : undefined}
      collapsed={collapsed}
      onToggle={onToggle}
      actions={
        <IconButton
          label={`Delete ${variable.name || `variable ${index + 1}`}`}
          icon='trash'
          size='compact'
          disabled={readOnly}
          onClick={onRemove}
        />
      }
    >
      <div className={styles.name} onKeyDown={blurOnEnter}>
        <FieldFrame id={nameId} label='Name' error={nameError}>
          <Input
            id={nameId}
            label='Name'
            name='name'
            autoComplete='off'
            value={localName ?? variable.name}
            onChange={onNameChange}
            onBlur={onNameCommit}
            placeholder={PLACEHOLDERS.name}
            disabled={readOnly}
            invalid={Boolean(nameError)}
            describedBy={fieldDescription(nameId, nameError)}
          />
        </FieldFrame>
      </div>
      <Select
        label='Type'
        field={{}}
        options={TYPE_OPTIONS}
        value={variable.type === 'string' ? 'plain' : variable.type}
        onValueChange={(type) => onUpdate('type', type)}
        disabled={readOnly}
      />
      <VariableValueField
        variable={variable}
        readOnly={readOnly}
        onChange={(value) => onUpdate('value', value)}
      />
    </EntryCard>
  )
}

/**
 * The right panel's Variables tab: the legacy floating Variables window's list, in the panel. Each
 * variable folds to its name and type; unfolded it edits its name (committed on blur or Enter,
 * refusing an empty or repeated name), its type and its typed value. Every write goes through the
 * collaborative variable operations, so other viewers see it live. A locked workflow, or a viewer
 * who cannot edit, reads the list without changing it.
 */
export function VariablesPanel() {
  const { workspaceId } = useWorkflowScope()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const variables = useVariablesStore((state) => state.variables)
  const { collaborativeUpdateVariable, collaborativeAddVariable, collaborativeDeleteVariable } =
    useCollaborativeWorkflow()
  const userPermissions = useUserPermissionsContext()
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const workflowLocked = isWorkflowEffectivelyLocked(
    activeWorkflowId ? (workflows[activeWorkflowId] ?? null) : null,
    folders
  )
  const readOnly = !userPermissions.canEdit || workflowLocked
  const scrollRef = useScrollEdges<HTMLDivElement>()

  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>({})
  const [localNames, setLocalNames] = useState<Record<string, string>>({})
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({})

  const workflowVariables = useMemo(
    () =>
      activeWorkflowId
        ? Object.values(variables).filter((variable) => variable.workflowId === activeWorkflowId)
        : [],
    [variables, activeWorkflowId]
  )

  const clearNameError = (variableId: string) =>
    setNameErrors((previous) => {
      if (!previous[variableId]) return previous
      const { [variableId]: _, ...rest } = previous
      return rest
    })

  const addVariable = () => {
    if (!activeWorkflowId || readOnly) return
    collaborativeAddVariable({ name: '', type: 'plain', value: '', workflowId: activeWorkflowId })
  }

  const changeName = (variableId: string, name: string) => {
    if (readOnly) return
    setLocalNames((previous) => ({ ...previous, [variableId]: validateName(name) }))
    clearNameError(variableId)
  }

  const commitName = (variableId: string) => {
    if (readOnly) return
    const localName = localNames[variableId]
    if (localName === undefined) return
    const trimmed = localName.trim()
    if (!trimmed) {
      setNameErrors((previous) => ({ ...previous, [variableId]: EMPTY_NAME_ERROR }))
      return
    }
    const duplicate = workflowVariables.some(
      (variable) => variable.id !== variableId && variable.name === trimmed
    )
    if (duplicate) {
      setNameErrors((previous) => ({ ...previous, [variableId]: DUPLICATE_NAME_ERROR }))
      return
    }
    collaborativeUpdateVariable(variableId, 'name', trimmed)
    setLocalNames((previous) => {
      const { [variableId]: _, ...rest } = previous
      return rest
    })
    clearNameError(variableId)
  }

  return (
    <section className={styles.panel} aria-label='Variables'>
      <header className={styles.header}>
        <h2 className={styles.title} data-type='T062'>
          Variables
        </h2>
        <IconButton
          label='Add variable'
          icon='I074'
          size='compact'
          tooltip
          disabled={readOnly || !activeWorkflowId}
          onClick={addVariable}
        />
      </header>
      {workflowVariables.length === 0 ? (
        <p className={styles.empty} data-type='T060'>
          No variables yet
        </p>
      ) : (
        <div ref={scrollRef} className={styles.body}>
          {workflowVariables.map((variable, index) => (
            <VariableEntry
              key={variable.id}
              variable={variable}
              index={index}
              readOnly={readOnly}
              collapsed={collapsedById[variable.id] ?? false}
              localName={localNames[variable.id]}
              nameError={nameErrors[variable.id]}
              onToggle={() =>
                setCollapsedById((previous) => ({
                  ...previous,
                  [variable.id]: !previous[variable.id],
                }))
              }
              onRemove={() => {
                if (!readOnly) collaborativeDeleteVariable(variable.id)
              }}
              onNameChange={(name) => changeName(variable.id, name)}
              onNameCommit={() => commitName(variable.id)}
              onUpdate={(field, value) => {
                if (!readOnly) collaborativeUpdateVariable(variable.id, field, value)
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}
