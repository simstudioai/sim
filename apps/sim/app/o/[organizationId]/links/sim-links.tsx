'use client'

import { type MouseEvent, useCallback, useMemo, useState } from 'react'
import { Avatar, ChipConfirmModal, ChipModalError, writeTextToClipboard } from '@sim/emcn'
import { Link } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useQueryStates } from 'nuqs'
import type { SimLink } from '@/lib/api/contracts/sim-links'
import { simLinkPath } from '@/lib/navigation/paths'
import { toSimLinkName } from '@/lib/sim-links/validation'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  NEW_SIM_LINK_ACTION,
  SIM_LINK_COLUMNS,
  SIM_LINKS_SEARCH_PLACEHOLDER,
} from '@/app/o/[organizationId]/links/columns'
import SimLinksLoading from '@/app/o/[organizationId]/links/loading'
import {
  simLinksParsers,
  simLinksSortParams,
  simLinksUrlKeys,
} from '@/app/o/[organizationId]/links/search-params'
import { SimLinkContextMenu } from '@/app/o/[organizationId]/links/sim-link-context-menu'
import { SimLinkIcon } from '@/app/o/[organizationId]/links/sim-link-icon'
import { SimLinkModal } from '@/app/o/[organizationId]/links/sim-link-modal'
import {
  ResourceLoadError,
  ResourceNoResults,
  SimLinksEmptyState,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import type {
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'
import { timeCell } from '@/app/workspace/[workspaceId]/components/resource/components/time-cell'
import {
  Resource,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useDeleteSimLink, useSimLinks } from '@/hooks/queries/sim-links'
import { useContextMenu } from '@/hooks/use-context-menu'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useUrlSort } from '@/hooks/use-url-sort'

const logger = createLogger('SimLinks')

const SORT_OPTIONS = [
  { id: 'name', label: 'Name' },
  { id: 'popular', label: 'Opens' },
] as const

/** How the link is shared beyond the default: open to everyone and editable by any member. */
function accessLabel(link: SimLink): string | null {
  const limits = [link.unlisted && 'Unlisted', link.restrictEdit && 'Restricted'].filter(Boolean)
  return limits.length ? limits.join(', ') : null
}

function openLink(name: string) {
  window.open(simLinkPath(name), '_blank', 'noopener,noreferrer')
}

async function copyLink(name: string) {
  try {
    await writeTextToClipboard(new URL(simLinkPath(name), window.location.origin).href)
  } catch (error) {
    logger.error('Failed to copy Sim link', { error })
  }
}

interface SimLinksProps {
  organizationId: string
}

/** Every Sim link the viewer may browse, in the shared resource table. */
export function SimLinks({ organizationId }: SimLinksProps) {
  const [{ search, create }, setView] = useQueryStates(simLinksParsers, simLinksUrlKeys)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setView({ search: value }, options)
  )
  const debouncedSearch = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS)
  const { sort, dir, activeSort, onSort, onClear } = useUrlSort(simLinksSortParams, simLinksUrlKeys)
  const query = debouncedSearch.trim()
  const links = useSimLinks(organizationId, query, sort, dir)
  const remove = useDeleteSimLink(organizationId)
  const contextMenu = useContextMenu()
  const [menuLinkId, setMenuLinkId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SimLink | null>(null)
  const [deleting, setDeleting] = useState<SimLink | null>(null)

  const loaded = useMemo(() => links.data?.pages.flatMap((page) => page.links) ?? [], [links.data])
  const linksById = useMemo(() => new Map(loaded.map((link) => [link.id, link])), [loaded])
  const menuLink = menuLinkId ? linksById.get(menuLinkId) : undefined

  const rows: ResourceRow[] = useMemo(
    () =>
      loaded.map((link) => ({
        id: link.id,
        cells: {
          name: { icon: <SimLinkIcon url={link.url} />, label: `sim/${link.name}` },
          destination: { label: link.url },
          description: { label: link.description },
          owner: link.createdBy
            ? {
                icon: (
                  <Avatar
                    size='xs'
                    name={link.createdBy.name}
                    src={link.createdBy.image}
                    aria-hidden
                  />
                ),
                label: link.createdBy.name,
              }
            : { label: null },
          access: { label: accessLabel(link) },
          updated: timeCell(link.updatedAt),
        },
      })),
    [loaded]
  )

  const searchConfig: SearchConfig = {
    value: search,
    onChange: setSearch,
    onClearAll: () => setSearch(''),
    placeholder: SIM_LINKS_SEARCH_PLACEHOLDER,
  }
  const sortConfig: SortConfig = { options: SORT_OPTIONS, active: activeSort, onSort, onClear }
  const startCreate = () => void setView({ create: '' })
  const { fetchNextPage } = links
  const { handleContextMenu } = contextMenu
  // Rows are memoized, so stable handlers keep a keystroke from re-rendering every row.
  const openRow = useCallback(
    (id: string) => {
      const link = linksById.get(id)
      if (link) openLink(link.name)
    },
    [linksById]
  )
  const openRowMenu = useCallback(
    (event: MouseEvent, id: string) => {
      if (!linksById.has(id)) return
      setMenuLinkId(id)
      handleContextMenu(event)
    },
    [linksById, handleContextMenu]
  )
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage])

  if (!links.data && !links.isLoadingError) return <SimLinksLoading />

  return (
    <Resource>
      <Resource.Header
        icon={Link}
        title='Sim Links'
        actions={[{ ...NEW_SIM_LINK_ACTION, id: 'create', onSelect: startCreate }]}
      />
      <Resource.Options search={searchConfig} sort={sortConfig} />
      <Resource.Table
        columns={SIM_LINK_COLUMNS}
        rows={rows}
        virtualized
        onRowClick={openRow}
        onRowContextMenu={openRowMenu}
        onLoadMore={loadMore}
        hasMore={links.hasNextPage}
        isLoadingMore={links.isFetchingNextPage}
        isFetching={links.isFetching}
        loadMoreFailed={links.isFetchNextPageError}
        emptyState={
          links.isLoadingError ? (
            <ResourceLoadError message={links.error.message} onRetry={() => void links.refetch()} />
          ) : query ? (
            <ResourceNoResults
              search={query}
              filterCount={0}
              searchScope='Searched every Sim link you can see.'
              onClear={() => setSearch('')}
            />
          ) : (
            <SimLinksEmptyState onCreate={startCreate} />
          )
        }
      />
      {menuLink && (
        <SimLinkContextMenu
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          onClose={contextMenu.closeMenu}
          onOpen={() => openLink(menuLink.name)}
          onCopyLink={() => void copyLink(menuLink.name)}
          onEdit={menuLink.canEdit ? () => setEditing(menuLink) : undefined}
          onDelete={
            menuLink.canEdit
              ? () => {
                  remove.reset()
                  setDeleting(menuLink)
                }
              : undefined
          }
        />
      )}
      {create !== null && (
        <SimLinkModal
          key={create}
          organizationId={organizationId}
          initialName={toSimLinkName(create)}
          onClose={() => void setView({ create: null })}
        />
      )}
      {editing && (
        <SimLinkModal
          key={editing.id}
          organizationId={organizationId}
          link={editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ChipConfirmModal
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null)
        }}
        title='Delete Sim link'
        text={`sim/${deleting?.name ?? ''} will stop working for everyone in your organization.`}
        confirm={{
          label: 'Delete',
          pendingLabel: 'Deleting',
          pending: remove.isPending,
          disabled: remove.isPending,
          onClick: () => {
            if (deleting) remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
          },
        }}
      >
        <ChipModalError>{remove.error?.message}</ChipModalError>
      </ChipConfirmModal>
    </Resource>
  )
}
