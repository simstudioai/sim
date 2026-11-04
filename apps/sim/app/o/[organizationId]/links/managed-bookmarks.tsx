import { useState } from 'react'
import { Chip, ChipCombobox, ChipModalField } from '@sim/emcn'
import type { BookmarkLink } from '@/lib/api/contracts/sim-links'
import { organizationRoutes } from '@/lib/navigation/paths'
import { MAX_MANAGED_BOOKMARKS } from '@/lib/sim-links/validation'
import { saveBlob } from '@/lib/uploads/client/download'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { useExportSimBookmarks, useSimLinks } from '@/hooks/queries/sim-links'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'

interface ManagedBookmarksProps {
  organizationId: string
}

export function ManagedBookmarks({ organizationId }: ManagedBookmarksProps) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<BookmarkLink[]>([])
  const [notice, setNotice] = useState('')
  const exporting = useExportSimBookmarks(organizationId)
  const query = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS)
  const links = useSimLinks(organizationId, query, 'name', 'asc')
  const listed = links.isPlaceholderData
    ? []
    : (links.data?.pages.flatMap((page) => page.links.filter((link) => !link.unlisted)) ?? [])
  const selectedIds = new Set(selected.map((link) => link.id))
  const candidates = new Map([...selected, ...listed].map((link) => [link.id, link]))
  const visible = new Set(listed.map((link) => link.id))
  const options = [...candidates.values()].map((link) => ({
    value: link.id,
    label: link.name,
    hidden: !visible.has(link.id),
    disabled: selected.length >= MAX_MANAGED_BOOKMARKS && !selectedIds.has(link.id),
  }))
  function choose(ids: string[]) {
    setNotice('')
    exporting.reset()
    setSelected(
      ids.flatMap((id) => {
        const link = candidates.get(id)
        return link ? [{ id: link.id, name: link.name }] : []
      })
    )
  }
  function download() {
    exporting.mutate(selected, {
      onSuccess: ({ links: current }) => {
        if (current.length !== selected.length) {
          setSelected(current)
          setNotice(
            'Some links changed or are no longer listed. Review your selection before exporting.'
          )
          return
        }
        const routes = organizationRoutes(organizationId)
        const children = current.map(({ name }) => ({
          name: `sim/${name}`,
          url: new URL(routes.openSimLink(name), window.location.origin).href,
        }))
        saveBlob(
          new Blob([JSON.stringify([{ name: 'Links', children }], null, 2)], {
            type: 'application/json',
          }),
          'sim-managed-bookmarks.json'
        )
      },
    })
  }
  return (
    <ChipModalField
      type='custom'
      title='Team bookmarks'
      hint='Choose links to include in your Chrome managed bookmarks policy.'
    >
      {(aria) => (
        <div className='flex flex-col items-start gap-2'>
          <ChipCombobox
            {...aria}
            options={options}
            className='w-full'
            multiSelect
            searchable
            searchMode='server'
            multiSelectValues={[...selectedIds]}
            disabled={exporting.isPending}
            onMultiSelectChange={choose}
            onSearchChange={setSearch}
            placeholder='Choose links'
            searchPlaceholder='Search links'
            isLoading={links.isFetching && !links.isFetchingNextPage}
            hasMore={links.hasNextPage}
            onLoadMore={() => void links.fetchNextPage()}
            isLoadingMore={links.isFetchingNextPage}
            error={links.isError ? 'Could not load links.' : undefined}
            emptyMessage='No listed links found'
          />
          <Chip onClick={download} disabled={!selected.length || exporting.isPending}>
            Export bookmarks
          </Chip>
          {(notice || exporting.isError) && (
            <span role='status' className='text-[var(--text-muted)] text-small'>
              {exporting.isError ? 'Could not export these bookmarks. Try again.' : notice}
            </span>
          )}
        </div>
      )}
    </ChipModalField>
  )
}
