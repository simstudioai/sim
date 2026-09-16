import { useCallback } from 'react'
import { useQueryStates } from 'nuqs'
import {
  organizationPageParsers,
  organizationPageUrlKeys,
} from '@/app/o/[organizationId]/components/organization-page/search-params'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

/**
 * The header filters of the organization page the caller sits on. The shell
 * drives them; a page's content reads `tab` and `search` to filter its list, so
 * the same criteria apply whichever tab is showing.
 */
export function useOrganizationPageFilters() {
  const [{ tab, q }, setFilters] = useQueryStates(organizationPageParsers, organizationPageUrlKeys)

  const setTab = useCallback((next: string | null) => setFilters({ tab: next }), [setFilters])
  const setSearch = useDebouncedSearchSetter((value, options) => setFilters({ q: value }, options))

  return { tab, search: q, setTab, setSearch }
}
