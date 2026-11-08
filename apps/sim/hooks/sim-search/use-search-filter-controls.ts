import { useQueryStates } from 'nuqs'
import {
  resourceUrlKeys,
  searchFilterParsers,
  UPDATED_WINDOWS,
} from '@/lib/mothership/chat/search-params'
import { connectorDisplayName } from '@/lib/sim-search/connectors'

/** A picker can't hold an empty string, so "every source" has a value of its own. */
const ALL_SOURCES = '__all_sources__'

function sourceOptionLabel(type: string): string {
  return type === 'upload' ? 'Uploads' : connectorDisplayName(type)
}

/** Shared refinements for indexed and live search, backed by the same URL parameters. */
export function useSearchFilterControls(sourceTypes: readonly string[]) {
  const [filters, setFilters] = useQueryStates(searchFilterParsers, resourceUrlKeys)
  return {
    source: {
      value: filters.source ?? ALL_SOURCES,
      label: `Filter by source: ${filters.source ? sourceOptionLabel(filters.source) : 'All sources'}`,
      options: [
        { value: ALL_SOURCES, label: 'All sources' },
        ...sourceTypes.map((type) => ({ value: type, label: sourceOptionLabel(type) })),
      ],
      onChange: (source: string) =>
        void setFilters({ source: source === ALL_SOURCES ? null : source }),
    },
    updated: {
      value: filters.updated,
      label: `Filter by date: ${UPDATED_WINDOWS.find((window) => window.id === filters.updated)?.label ?? 'Any time'}`,
      options: UPDATED_WINDOWS.map((window) => ({ value: window.id, label: window.label })),
      onChange: (value: string) => {
        const window = UPDATED_WINDOWS.find((entry) => entry.id === value)
        if (window)
          void setFilters(
            window.id === 'custom'
              ? { updated: window.id }
              : { updated: window.id, from: null, to: null }
          )
      },
    },
    range:
      filters.updated === 'custom'
        ? {
            start: filters.from?.toISOString().slice(0, 10),
            end: filters.to?.toISOString().slice(0, 10),
            onChange: (start: string, end: string) =>
              void setFilters({ from: new Date(start), to: new Date(end) }),
            onClear: () => void setFilters({ updated: 'any', from: null, to: null }),
          }
        : null,
  }
}
