'use client'

import { Combobox, type ComboboxOptionGroup, Label } from '@/components/emcn'
import type { ColumnDefinition, WorkflowGroup } from '@/lib/table'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const DEP_VALUE_PREFIX_COLUMN = 'col:'
const DEP_VALUE_PREFIX_GROUP = 'group:'

interface RunSettingsSectionProps {
  scalarDepColumns: ColumnDefinition[]
  groupDepOptions: WorkflowGroup[]
  /** Plain column names this group waits on. */
  deps: string[]
  /** Producing workflow group ids this group waits on. */
  groupDeps: string[]
  workflows: WorkflowMetadata[] | undefined
  onChangeDeps: (next: string[]) => void
  onChangeGroupDeps: (next: string[]) => void
}

/**
 * "Run after" picker: which upstream columns + workflow groups must be
 * filled before this group fires. Empty selection = the group fires on any
 * row change. Same Combobox shape as the Output columns picker.
 *
 * Inner derivations (`groups`, `flatOptions`, `selected`) are computed inline
 * — the previous version memo'd each, but the deps change frequently and the
 * arrays are short, so the memos never paid for themselves.
 */
export function RunSettingsSection({
  scalarDepColumns,
  groupDepOptions,
  deps,
  groupDeps,
  workflows,
  onChangeDeps,
  onChangeGroupDeps,
}: RunSettingsSectionProps) {
  const groups: ComboboxOptionGroup[] = []
  if (scalarDepColumns.length > 0) {
    groups.push({
      section: 'Columns',
      items: scalarDepColumns.map((c) => ({
        label: c.name,
        value: `${DEP_VALUE_PREFIX_COLUMN}${c.name}`,
      })),
    })
  }
  if (groupDepOptions.length > 0) {
    groups.push({
      section: 'Workflow groups',
      items: groupDepOptions.map((g) => {
        const wf = workflows?.find((w) => w.id === g.workflowId)
        const color = wf?.color ?? 'var(--text-muted)'
        const label = g.name ?? wf?.name ?? 'Workflow'
        return {
          label,
          value: `${DEP_VALUE_PREFIX_GROUP}${g.id}`,
          iconElement: (
            <span
              className='h-[10px] w-[10px] shrink-0 rounded-sm'
              style={{ backgroundColor: color }}
              aria-hidden='true'
            />
          ),
        }
      }),
    })
  }

  const selected = [
    ...deps.map((d) => `${DEP_VALUE_PREFIX_COLUMN}${d}`),
    ...groupDeps.map((g) => `${DEP_VALUE_PREFIX_GROUP}${g}`),
  ]

  function handleChange(next: string[]) {
    const nextDeps: string[] = []
    const nextGroupDeps: string[] = []
    for (const v of next) {
      if (v.startsWith(DEP_VALUE_PREFIX_COLUMN))
        nextDeps.push(v.slice(DEP_VALUE_PREFIX_COLUMN.length))
      else if (v.startsWith(DEP_VALUE_PREFIX_GROUP))
        nextGroupDeps.push(v.slice(DEP_VALUE_PREFIX_GROUP.length))
    }
    onChangeDeps(nextDeps)
    onChangeGroupDeps(nextGroupDeps)
  }

  const totalOptionCount = scalarDepColumns.length + groupDepOptions.length

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
        disabled={totalOptionCount === 0}
        emptyMessage='No upstream columns or groups.'
        // Combobox ignores `options` when `groups` is set (see combobox.tsx),
        // but the prop is required by the type — pass an empty array.
        options={[]}
        groups={groups}
        multiSelectValues={selected}
        onMultiSelectChange={handleChange}
        overlayContent={
          <span className='truncate text-[var(--text-primary)]'>
            {selected.length === 0 ? 'Any row change' : `${selected.length} selected`}
          </span>
        }
      />
    </div>
  )
}
