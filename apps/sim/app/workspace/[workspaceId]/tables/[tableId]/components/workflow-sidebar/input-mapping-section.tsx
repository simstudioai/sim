'use client'

import { useState } from 'react'
import { Badge, Combobox, Label } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { handleKeyboardActivation } from '@/lib/core/utils/keyboard'
import type { ColumnDefinition } from '@/lib/table'
import type { InputFormatField } from '@/lib/workflows/types'

interface InputMappingSectionProps {
  /** The workflow Start block's input fields. Each gets one collapsible row. */
  inputFields: InputFormatField[]
  /** Columns the user can feed into an input (all table columns). */
  columnOptions: ColumnDefinition[]
  /** Current mapping: input field name → table column name. */
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
}

/**
 * "Workflow inputs" panel: maps each of the workflow's Start-block input fields
 * to the table column whose per-row value feeds it. Each field renders as a
 * collapsible card — header shows the field name + type badge, the body holds
 * the column picker — mirroring the workflow editor's input-mapping rows.
 */
export function InputMappingSection({
  inputFields,
  columnOptions,
  value,
  onChange,
}: InputMappingSectionProps) {
  const namedFields = inputFields.filter((f): f is InputFormatField & { name: string } =>
    Boolean(f.name?.trim())
  )
  const columns = columnOptions.map((c) => ({ label: c.name, value: c.name }))
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggle = (name: string) => setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }))

  return (
    <div className='flex flex-col gap-[9.5px]'>
      <Label className='flex items-baseline gap-1.5 whitespace-nowrap pl-0.5'>
        Workflow inputs
        <span className='ml-0.5'>*</span>
      </Label>
      {namedFields.length === 0 ? (
        <p className='pl-0.5 text-[var(--text-tertiary)] text-caption'>
          This workflow has no Start block inputs.
        </p>
      ) : (
        <div className='flex flex-col gap-2'>
          {namedFields.map((field) => {
            const isCollapsed = collapsed[field.name] ?? false
            return (
              <div
                key={field.name}
                className={cn(
                  'rounded-sm border border-[var(--border-1)]',
                  isCollapsed ? 'overflow-hidden' : 'overflow-visible'
                )}
              >
                <div
                  role='button'
                  tabIndex={0}
                  className='flex cursor-pointer items-center justify-between rounded-t-[4px] bg-[var(--surface-4)] px-2.5 py-[5px]'
                  onClick={() => toggle(field.name)}
                  onKeyDown={(event) => handleKeyboardActivation(event, () => toggle(field.name))}
                >
                  <div className='flex min-w-0 flex-1 items-center gap-2'>
                    <span className='block truncate font-medium text-[var(--text-tertiary)] text-sm'>
                      {field.name}
                    </span>
                    {field.type && (
                      <Badge variant='type' size='sm'>
                        {field.type}
                      </Badge>
                    )}
                  </div>
                </div>

                {!isCollapsed && (
                  <div className='flex flex-col gap-1.5 rounded-b-[4px] border-[var(--border-1)] border-t bg-[var(--surface-2)] px-2.5 pt-1.5 pb-2.5'>
                    <Label className='text-small'>Column</Label>
                    <Combobox
                      searchable
                      searchPlaceholder='Search columns…'
                      size='sm'
                      className='h-[32px] w-full rounded-md'
                      dropdownWidth='trigger'
                      maxHeight={240}
                      disabled={columns.length === 0}
                      emptyMessage='No columns.'
                      placeholder='Select a column'
                      options={columns}
                      value={value[field.name] ?? ''}
                      onChange={(columnName: string) =>
                        onChange({ ...value, [field.name]: columnName })
                      }
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
