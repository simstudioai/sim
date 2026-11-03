import { useState } from 'react'
import { Avatar } from '@sim/emcn'
import { PEOPLE_SEARCH_MAX_LENGTH } from '@/lib/people/validation'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { usePeople } from '@/hooks/queries/people'
import { useDebounce } from '@/hooks/use-debounce'

/** Shared, paginated directory search for chart navigation and editing a person's manager. */
export function usePeoplePicker(
  organizationId: string,
  scope?: 'roots' | 'members',
  excludeMemberId?: string
) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const term = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const query = usePeople(organizationId, term, '', { scope, enabled: open })
  const waiting = search.trim() !== term || query.isPlaceholderData
  const people =
    waiting || query.isRefetchError
      ? []
      : (query.data?.pages ?? []).flatMap((page) =>
          page.people.filter((person) => person.memberId !== excludeMemberId)
        )
  return {
    search,
    people,
    pickerProps: {
      searchable: true,
      searchMaxLength: PEOPLE_SEARCH_MAX_LENGTH,
      searchMode: 'server' as const,
      onSearchChange: setSearch,
      onOpenChange: setOpen,
      options: people.map((person) => ({
        value: person.memberId,
        label: [person.name, person.title, person.email].filter(Boolean).join(' · '),
        iconElement: <Avatar size='xs' name={person.name} src={person.image} aria-hidden />,
      })),
      hasMore: query.hasNextPage && !waiting,
      onLoadMore: () => void query.fetchNextPage(),
      isLoading: waiting || (query.isFetching && !query.isFetchingNextPage),
      isLoadingMore: query.isFetchingNextPage,
      error: query.error?.message,
    },
  }
}
