'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Badge, ChipCombobox, CollapsibleCard, Label } from '@/components/emcn'
import type { ColumnDefinition } from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'
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
  const t = useTranslations('auto')
  const namedFields = inputFields.filter((f): f is InputFormatField & { name: string } =>
    Boolean(f.name?.trim())
  )
  const columns = columnOptions.map((c) => ({ label: c.name, value: getColumnId(c) }))
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggle = (name: string) => setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }))

  return (
    <div className='flex flex-col gap-[9.5px]'>
      <Label className='flex items-baseline gap-1.5 whitespace-nowrap pl-0.5'>
        {t('workflow_inputs')}
      </Label>
      {namedFields.length === 0 ? (
        <p className='pl-0.5 text-[var(--text-tertiary)] text-caption'>
          {t('this_workflow_has_no_start_block')}
        </p>
      ) : (
        <div className='flex flex-col gap-2'>
          {namedFields.map((field) => (
            <CollapsibleCard
              key={field.name}
              title={field.name}
              badge={
                field.type ? (
                  <Badge variant='type' size='sm'>
                    {field.type}
                  </Badge>
                ) : undefined
              }
              collapsed={collapsed[field.name] ?? false}
              onToggleCollapse={() => toggle(field.name)}
            >
              <Label className='text-small'>{t('column')}</Label>
              <ChipCombobox
                searchable
                searchPlaceholder='Search columns…'
                className='w-full'
                dropdownWidth='trigger'
                maxHeight={240}
                disabled={columns.length === 0}
                emptyMessage={t('no_columns')}
                placeholder={t('select_a_column')}
                options={columns}
                value={value[field.name] ?? ''}
                onChange={(columnName: string) => onChange({ ...value, [field.name]: columnName })}
              />
            </CollapsibleCard>
          ))}
        </div>
      )}
    </div>
  )
}
