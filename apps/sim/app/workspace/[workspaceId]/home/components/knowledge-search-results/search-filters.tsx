import { ChipDatePicker, ChipDropdown } from '@sim/emcn'
import { useSearchFilterControls } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/use-search-filter-controls'

interface SearchFiltersProps {
  sourceTypes: readonly string[]
}

/** The refinement controls in the app's chip chrome. */
export function SearchFilters({ sourceTypes }: SearchFiltersProps) {
  const { source, updated, range } = useSearchFilterControls(sourceTypes)
  return (
    <div
      role='group'
      aria-label='Search filters'
      className='flex flex-wrap items-center gap-2 px-2 py-2'
    >
      <ChipDropdown
        variant='ghost'
        shape='round'
        aria-label={source.label}
        matchTriggerWidth={false}
        value={source.value}
        options={source.options}
        onChange={source.onChange}
      />
      <ChipDropdown
        variant='ghost'
        shape='round'
        aria-label={updated.label}
        matchTriggerWidth={false}
        value={updated.value}
        options={updated.options}
        onChange={updated.onChange}
      />
      {range && (
        <ChipDatePicker
          mode='range'
          variant='ghost'
          placeholder='Updated between'
          startDate={range.start}
          endDate={range.end}
          onRangeChange={range.onChange}
          onClear={range.onClear}
        />
      )}
    </div>
  )
}
