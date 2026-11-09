'use client'

import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import {
  SidePanelNote,
  SidePanelSection,
} from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/side-panel/side-panel'
import {
  type ColumnDefinition,
  getColumnId,
  type InputFormatField,
} from '@/platform/lib/data/tables'

interface InputMappingFieldsProps {
  /** The input fields of the workflow's Start block; each takes one column. */
  inputFields: readonly InputFormatField[]
  columns: readonly ColumnDefinition[]
  /** Input field name to the id of the column whose row value feeds it. */
  value: Readonly<Record<string, string>>
  onChange: (next: Record<string, string>) => void
}

/**
 * The workflow's inputs, each mapped to the table column whose value it receives on every row run.
 * A field's type reads beneath its picker.
 */
export function InputMappingFields({
  inputFields,
  columns,
  value,
  onChange,
}: InputMappingFieldsProps) {
  const namedFields = inputFields.filter((field): field is InputFormatField & { name: string } =>
    Boolean(field.name?.trim())
  )
  const options = columns.map((column) => ({ value: getColumnId(column), label: column.name }))
  return (
    <SidePanelSection title='Workflow inputs'>
      {namedFields.length === 0 ? (
        <SidePanelNote>This workflow has no Start block inputs.</SidePanelNote>
      ) : (
        namedFields.map((field) => (
          <SearchableSelect
            key={field.name}
            label={field.name}
            hint={field.type || undefined}
            options={options}
            value={value[field.name] || null}
            onValueChange={(columnId) => onChange({ ...value, [field.name]: columnId ?? '' })}
            placeholder='Select a column'
            searchLabel='Search columns'
            disabled={options.length === 0}
            disabledReason={options.length === 0 ? 'No columns' : undefined}
          />
        ))
      )}
    </SidePanelSection>
  )
}
