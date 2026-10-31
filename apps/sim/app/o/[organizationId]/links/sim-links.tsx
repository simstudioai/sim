'use client'

import { useMemo, useState } from 'react'
import { Avatar, Chip, ChipConfirmModal, ChipModalError, writeTextToClipboard } from '@sim/emcn'
import { Link, Plus } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useQueryStates } from 'nuqs'
import { EmptyState } from '@/components/empty-state/empty-state'
import type { SimLink } from '@/lib/api/contracts/sim-links'
import { simLinkPath } from '@/lib/navigation/paths'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  simLinksParsers,
  simLinksSortParams,
  simLinksUrlKeys,
} from '@/app/o/[organizationId]/links/search-params'
import { SimLinkContextMenu } from '@/app/o/[organizationId]/links/sim-link-context-menu'
import { SimLinkIcon } from '@/app/o/[organizationId]/links/sim-link-icon'
import { SimLinkModal } from '@/app/o/[organizationId]/links/sim-link-modal'
import { SimLinksEmptyState } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import type {
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'
import { timeCell } from '@/app/workspace/[workspaceId]/components/resource/components/time-cell'
import {
  Resource,
  type ResourceColumn,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useDeleteSimLink, useSimLinks } from '@/hooks/queries/sim-links'
import { useContextMenu } from '@/hooks/use-context-menu'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useUrlSort } from '@/hooks/use-url-sort'

const logger = createLogger('SimLinks')

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', widthMultiplier: 0.7 },
  { id: 'destination', header: 'Destination', widthMultiplier: 1.6 },
  { id: 'description', header: 'Description', widthMultiplier: 1.4 },
  { id: 'owner', header: 'Created by' },
  { id: 'opens', header: 'Opens', widthMultiplier: 0.7 },
  { id: 'access', header: 'Access' },
  { id: 'updated', header: 'Last updated' },
]

const SORT_OPTIONS = [
  { id: 'name', label: 'Name' },
  { id: 'popular', label: 'Opens' },
]

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
  const links = useSimLinks(organizationId, debouncedSearch.trim(), sort, dir)
  const remove = useDeleteSimLink(organizationId)
  const contextMenu = useContextMenu()
  const [menuLink, setMenuLink] = useState<SimLink | null>(null)
  const [editing, setEditing] = useState<SimLink | null>(null)
  const [deleting, setDeleting] = useState<SimLink | null>(null)

  const loaded = useMemo(() => links.data?.pages.flatMap((page) => page.links) ?? [], [links.data])
  const linksById = useMemo(() => new Map(loaded.map((link) => [link.id, link])), [loaded])

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
          opens: { label: String(link.visitCount) },
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
    placeholder: 'Search Sim links...',
  }
  const sortConfig: SortConfig = { options: SORT_OPTIONS, active: activeSort, onSort, onClear }
  const searching = Boolean(debouncedSearch.trim())
  const startCreate = () => void setView({ create: '' })

  return (
    <Resource>
      <Resource.Header
        icon={Link}
        title='Sim Links'
        actions={[
          { id: 'create', text: 'New link', icon: Plus, variant: 'primary', onSelect: startCreate },
        ]}
      />
      <Resource.Options search={searchConfig} sort={sortConfig} />
      <Resource.Table
        columns={COLUMNS}
        rows={rows}
        onRowClick={(id) => {
          const link = linksById.get(id)
          if (link) openLink(link.name)
        }}
        onRowContextMenu={(event, id) => {
          const link = linksById.get(id)
          if (!link) return
          setMenuLink(link)
          contextMenu.handleContextMenu(event)
        }}
        onLoadMore={() => void links.fetchNextPage()}
        hasMore={links.hasNextPage}
        isLoadingMore={links.isFetchingNextPage}
        isFetching={links.isFetching}
        loadMoreFailed={links.isFetchNextPageError}
        emptyState={
          links.isLoadingError ? (
            <div role='alert' className='flex flex-col items-center gap-3 p-6'>
              <p className='text-[var(--text-error)] text-small'>{links.error.message}</p>
              <Chip onClick={() => void links.refetch()}>Retry</Chip>
            </div>
          ) : !links.data ? undefined : searching ? (
            <EmptyState
              title={`No results for “${debouncedSearch.trim()}”`}
              description='Searched every Sim link in your organization.'
              action={
                <Chip variant='border' onClick={() => setSearch('')}>
                  Clear search
                </Chip>
              }
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
          initialName={create}
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
