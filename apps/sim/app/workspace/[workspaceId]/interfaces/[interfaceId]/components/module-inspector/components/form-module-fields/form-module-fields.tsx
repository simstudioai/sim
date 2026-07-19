'use client'

import { useMemo } from 'react'
import { Chip, ChipCombobox, ChipInput, FieldDivider } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { generateId } from '@sim/utils/id'
import { INTERFACE_LAYOUT_LIMITS } from '@/lib/interfaces/constants'
import type { FormField, FormModuleConfig } from '@/lib/interfaces/types'
import { InspectorField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/inspector-field'
import { FormFieldRow } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/form-module-fields/components/form-field-row'
import {
  countFieldNames,
  isFormConfigValid,
} from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/form-module-fields/utils'
import { useWorkflows } from '@/hooks/queries/workflows'

/** Applied when the submit label is left empty, so the layout always saves. */
const DEFAULT_SUBMIT_LABEL = 'Submit'

/**
 * Unlike the chat module — which runs the saved draft state over a session
 * request — a submit goes through `preprocessExecution`, whose `checkDeployment`
 * default is on for the `form` trigger. An undeployed workflow 403s, so the
 * requirement is stated up front.
 */
const WORKFLOW_HINT =
  "Field names become Start-block inputs. Declare matching inputs on the workflow's Start block so they type-coerce and autocomplete as <start.fieldName>. Submissions run the deployed version, so deploy the workflow before sharing the form."

/**
 * Builds the next field with a name that no existing field has taken. Field
 * ids are wire keys for submitted values, so they must be stable and unique.
 */
function createFormField(existing: readonly FormField[]): FormField {
  const taken = new Set(existing.map((field) => field.name.toLowerCase()))
  let index = existing.length + 1
  while (taken.has(`field_${index}`)) index += 1
  return {
    id: generateId(),
    name: `field_${index}`,
    label: `Field ${index}`,
    type: 'short-text',
    required: false,
  }
}

export interface FormModuleFieldsProps {
  workspaceId: string
  value: FormModuleConfig
  onChange: (next: FormModuleConfig, isValid: boolean) => void
  disabled?: boolean
}

/**
 * Inspector section for a form module: the workflow the submission runs, the
 * submit button's label, and the user-defined field list. Fully controlled —
 * every edit is reported through `onChange` along with whether the resulting
 * config is safe to persist, so mid-edit invalid states never reach the PATCH.
 */
export function FormModuleFields({
  workspaceId,
  value,
  onChange,
  disabled,
}: FormModuleFieldsProps) {
  const { data: workflows, isPending: isLoadingWorkflows } = useWorkflows(workspaceId)

  const workflowOptions = useMemo(
    () =>
      [...(workflows ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((workflow) => ({ label: workflow.name, value: workflow.id })),
    [workflows]
  )

  const fields = value.fields

  /** One pass over the fields; each row then reads its duplicate flag in O(1). */
  const nameCounts = useMemo(() => countFieldNames(fields), [fields])

  const submitLabelError =
    value.submitLabel.trim().length === 0 ? 'Submit label is required' : undefined

  function updateConfig(patch: Partial<FormModuleConfig>): void {
    const next = { ...value, ...patch }
    onChange(next, isFormConfigValid(next))
  }

  function handleFieldChange(index: number, next: FormField): void {
    updateConfig({ fields: fields.map((field, i) => (i === index ? next : field)) })
  }

  function handleFieldRemove(index: number): void {
    updateConfig({ fields: fields.filter((_, i) => i !== index) })
  }

  function handleFieldMove(index: number, direction: 'up' | 'down'): void {
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= fields.length) return
    const next = [...fields]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    updateConfig({ fields: next })
  }

  function handleAddField(): void {
    if (fields.length >= INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS) return
    updateConfig({ fields: [...fields, createFormField(fields)] })
  }

  return (
    <div className='flex flex-col'>
      <InspectorField title='Workflow' hint={WORKFLOW_HINT}>
        <ChipCombobox
          options={workflowOptions}
          value={value.workflowId ?? ''}
          onChange={(next) => updateConfig({ workflowId: next.length > 0 ? next : null })}
          placeholder='Select a workflow'
          searchable
          searchPlaceholder='Search workflows...'
          isLoading={isLoadingWorkflows}
          emptyMessage='No workflows in this workspace'
          maxHeight={260}
          disabled={disabled}
          aria-label='Workflow'
        />
      </InspectorField>

      <FieldDivider />

      <InspectorField title='Submit label' required error={submitLabelError}>
        {(control) => (
          <ChipInput
            value={value.submitLabel}
            onChange={(event) => updateConfig({ submitLabel: event.target.value })}
            onBlur={() => {
              if (value.submitLabel.trim().length === 0) {
                updateConfig({ submitLabel: DEFAULT_SUBMIT_LABEL })
              }
            }}
            placeholder={DEFAULT_SUBMIT_LABEL}
            maxLength={INTERFACE_LAYOUT_LIMITS.MAX_SUBMIT_LABEL_LENGTH}
            error={Boolean(submitLabelError)}
            disabled={disabled}
            {...control}
          />
        )}
      </InspectorField>

      <FieldDivider />

      <InspectorField title='Fields'>
        <div className='flex flex-col gap-2'>
          {fields.length === 0 ? (
            <p className='pl-0.5 text-[var(--text-muted)] text-caption'>
              No fields yet. Add one to start collecting input.
            </p>
          ) : (
            fields.map((field, index) => (
              <FormFieldRow
                key={field.id}
                field={field}
                duplicateName={(nameCounts.get(field.name.toLowerCase()) ?? 0) > 1}
                onChange={(next) => handleFieldChange(index, next)}
                onRemove={() => handleFieldRemove(index)}
                onMove={(direction) => handleFieldMove(index, direction)}
                canMoveUp={index > 0}
                canMoveDown={index < fields.length - 1}
                disabled={disabled}
              />
            ))
          )}

          <Chip
            leftIcon={Plus}
            onClick={handleAddField}
            fullWidth
            disabled={disabled || fields.length >= INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS}
          >
            Add field
          </Chip>
        </div>
      </InspectorField>
    </div>
  )
}
