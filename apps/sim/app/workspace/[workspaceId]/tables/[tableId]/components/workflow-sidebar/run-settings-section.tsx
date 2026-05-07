'use client'

import { Combobox, Label } from '@/components/emcn'
import type { ColumnDefinition } from '@/lib/table'

interface RunSettingsSectionProps {
  /** All columns the group can depend on (left-of-current scalar + workflow
   *  output columns alike). */
  depOptions: ColumnDefinition[]
  /** Column names this group waits on. */
  deps: string[]
  onChangeDeps: (next: string[]) => void
}

/**
 * "Run after" picker: which upstream columns must be filled before this group
 * fires. Workflow output columns count the same as plain columns — once a
 * column is non-empty, the dep is satisfied. Empty selection = the group fires
 * on any row change.
 */
export function RunSettingsSection({ depOptions, deps, onChangeDeps }: RunSettingsSectionProps) {
  const options = depOptions.map((c) => ({ label: c.name, value: c.name }))

  return (
    <div className='flex flex-col gap-[9.5px]'>
      <Label className='flex items-baseline gap-1.5 whitespace-nowrap pl-0.5'>Run after</Label>
      <Combobox
        multiSelect
        searchable
        searchPlaceholder='Search…'
        size='sm'
        className='h-[32px] w-full rounded-md'
        dropdownWidth='trigger'
        maxHeight={240}
        disabled={depOptions.length === 0}
        emptyMessage='No upstream columns.'
        options={options}
        multiSelectValues={deps}
        onMultiSelectChange={onChangeDeps}
        overlayContent={
          <span className='truncate text-[var(--text-primary)]'>
            {deps.length === 0 ? 'Any row change' : `${deps.length} selected`}
          </span>
        }
      />
    </div>
  )
}
