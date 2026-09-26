import { ChipDatePicker, ChipDropdown } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import {
  resourceUrlKeys,
  searchFilterParsers,
  UPDATED_WINDOWS,
} from '@/app/workspace/[workspaceId]/home/search-params'

interface SearchFiltersProps {
  sourceTypes: readonly string[]
}

/** Shared refinements for indexed and live search, backed by the same URL parameters. */
export function SearchFilters({ sourceTypes }: SearchFiltersProps) {
  const [filters, setFilters] = useQueryStates(searchFilterParsers, resourceUrlKeys)
  return (
    <div
      role='group'
      aria-label='Search filters'
      className='flex flex-wrap items-center gap-2 px-2 py-2'
    >
      <ChipDropdown
        variant='ghost'
        shape='round'
        aria-label='Filter by source'
        matchTriggerWidth={false}
        value={filters.source ?? ''}
        options={[
          { value: '', label: 'All sources' },
          ...sourceTypes.map((type) => ({
            value: type,
            label: type === 'upload' ? 'Uploads' : connectorDisplayName(type),
          })),
        ]}
        onChange={(source) => void setFilters({ source: source || null })}
      />
      <ChipDropdown
        variant='ghost'
        shape='round'
        aria-label='Filter by date'
        matchTriggerWidth={false}
        value={filters.updated}
        options={UPDATED_WINDOWS.map((window) => ({ value: window.id, label: window.label }))}
        onChange={(value) => {
          const window = UPDATED_WINDOWS.find((entry) => entry.id === value)
          if (window)
            void setFilters(
              window.id === 'custom'
                ? { updated: window.id }
                : { updated: window.id, from: null, to: null }
            )
        }}
      />
      {filters.updated === 'custom' && (
        <ChipDatePicker
          mode='range'
          variant='ghost'
          placeholder='Updated between'
          startDate={filters.from?.toISOString().slice(0, 10)}
          endDate={filters.to?.toISOString().slice(0, 10)}
          onRangeChange={(start, end) =>
            void setFilters({ from: new Date(start), to: new Date(end) })
          }
          onClear={() => void setFilters({ from: null, to: null })}
        />
      )}
    </div>
  )
}
