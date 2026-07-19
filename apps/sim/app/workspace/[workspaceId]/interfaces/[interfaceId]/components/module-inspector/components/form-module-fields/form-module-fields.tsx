'use client'

import { useCallback, useMemo, useState } from 'react'
import { Chip, ChipInput, cn, FieldDivider } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { generateId } from '@sim/utils/id'
import { INTERFACE_LAYOUT_LIMITS } from '@/lib/interfaces/constants'
import { countFieldNames, isFormConfigValid } from '@/lib/interfaces/form-config'
import type { FormField, FormModuleConfig } from '@/lib/interfaces/types'
import { InspectorField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/inspector-field'
import { FormFieldRow } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/form-module-fields/components/form-field-row'
import { ResourcePickerField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/resource-picker-field'
import { useWorkflows } from '@/hooks/queries/workflows'
import { reorderList, useDragReorder } from '@/hooks/use-drag-reorder'

/** Applied when the submit label is left empty, so the layout always saves. */
const DEFAULT_SUBMIT_LABEL = 'Submit'

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
  const workflows = useWorkflows(workspaceId)
  /**
   * One expanded field at a time — an accordion rather than a wall of open
   * cards, which is what made a form of any size unreadable. Adding a field
   * expands it, since a new field is the one you came here to configure.
   */
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null)

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

  /** Stable identity so the drag hook's per-row handlers survive every keystroke. */
  const handleFieldReorder = useCallback(
    (from: number, to: number) => {
      const next = { ...value, fields: reorderList(value.fields, from, to) }
      onChange(next, isFormConfigValid(next))
    },
    [value, onChange]
  )

  const fieldDrag = useDragReorder(handleFieldReorder, !disabled)

  function handleAddField(): void {
    if (fields.length >= INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS) return
    const field = createFormField(fields)
    setExpandedFieldId(field.id)
    updateConfig({ fields: [...fields, field] })
  }

  return (
    <div className='flex flex-col'>
      <ResourcePickerField
        title='Workflow'
        missingMessage='This workflow is no longer in the workspace.'
        placeholder='Select a workflow'
        searchPlaceholder='Search workflows...'
        emptyMessage='No workflows in this workspace'
        items={workflows.data}
        isLoading={workflows.isLoading}
        value={value.workflowId}
        onChange={(next) => updateConfig({ workflowId: next })}
        disabled={disabled}
      />

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
          {fields.map((field, index) => (
            <div
              key={field.id}
              {...fieldDrag.itemProps(index)}
              className={cn(
                '-my-px border-transparent border-t-2 border-b-2 py-px transition-colors',
                /**
                 * The line marks where the row will LAND. `reorderList` splices
                 * out before inserting, so a downward drag settles *after* the
                 * hovered row — drawing the line above it would point one row
                 * high.
                 */
                fieldDrag.overIndex === index &&
                  fieldDrag.draggingIndex !== null &&
                  fieldDrag.draggingIndex !== index &&
                  (fieldDrag.draggingIndex < index
                    ? 'border-b-[var(--text-muted)]'
                    : 'border-t-[var(--text-muted)]'),
                fieldDrag.draggingIndex === index && 'opacity-50'
              )}
            >
              <FormFieldRow
                field={field}
                duplicateName={(nameCounts.get(field.name.toLowerCase()) ?? 0) > 1}
                collapsed={expandedFieldId !== field.id}
                onToggleCollapse={() =>
                  setExpandedFieldId((previous) => (previous === field.id ? null : field.id))
                }
                onChange={(next) => handleFieldChange(index, next)}
                onRemove={() => handleFieldRemove(index)}
                disabled={disabled}
              />
            </div>
          ))}

          {/** The same chip the module renders, so both add-field affordances read alike. */}
          <Chip
            active
            fullWidth
            flush
            centered
            leftIcon={Plus}
            onClick={handleAddField}
            disabled={disabled || fields.length >= INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS}
          >
            Add field
          </Chip>
        </div>
      </InspectorField>
    </div>
  )
}
