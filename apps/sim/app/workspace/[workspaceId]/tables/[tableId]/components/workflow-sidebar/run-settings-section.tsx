'use client'

import { useTranslations } from 'next-intl'
import { ChipCombobox, Label } from '@/components/emcn'
import type { ColumnDefinition } from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'

interface RunSettingsSectionProps {
  /** All columns the group can depend on (left-of-current scalar + workflow
   *  output columns alike). */
  depOptions: ColumnDefinition[]
  /** Column names this group waits on. */
  deps: string[]
  onChangeDeps: (next: string[]) => void
  /** Inline validation error rendered under the picker. */
  error?: string | null
}

/**
 * "Run after" picker: which upstream columns must be filled before this group
 * fires. Workflow output columns count the same as plain columns — once a
 * column is non-empty, the dep is satisfied. At least one dep is required
 * when auto-run is on.
 */
export function RunSettingsSection({
  depOptions,
  deps,
  onChangeDeps,
  error,
}: RunSettingsSectionProps) {
  const t = useTranslations('auto')
  const options = depOptions.map((c) => ({ label: c.name, value: getColumnId(c) }))

  return (
    <div className='flex flex-col gap-[9.5px]'>
      <Label className='flex items-baseline gap-1.5 whitespace-nowrap pl-0.5'>
        {t('run_after')}
      </Label>
      <ChipCombobox
        multiSelect
        searchable
        searchPlaceholder='Search…'
        className='w-full'
        dropdownWidth='trigger'
        maxHeight={240}
        disabled={depOptions.length === 0}
        emptyMessage={t('no_upstream_columns')}
        options={options}
        multiSelectValues={deps}
        onMultiSelectChange={onChangeDeps}
        overlayContent={
          <span className='truncate text-[var(--text-tertiary)]'>
            {deps.length === 0 ? 'Select at least one column' : `${deps.length} selected`}
          </span>
        }
      />
      {error && <p className='pl-0.5 text-[var(--text-error)] text-caption'>{error}</p>}
    </div>
  )
}
