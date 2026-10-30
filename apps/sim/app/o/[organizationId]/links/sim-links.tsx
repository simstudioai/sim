'use client'

import { useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipModalError,
  ChipTag,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  writeTextToClipboard,
} from '@sim/emcn'
import { Link, MoreHorizontal, Plus } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { formatRelativeTime } from '@sim/utils/formatting'
import { useQueryStates } from 'nuqs'
import type { SimLink } from '@/lib/api/contracts/sim-links'
import { simLinkPath } from '@/lib/navigation/paths'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  OrganizationPage,
  type OrganizationPageTab,
  useOrganizationPageFilters,
} from '@/app/o/[organizationId]/components/organization-page'
import { simLinkViewParsers } from '@/app/o/[organizationId]/links/search-params'
import { SimLinkModal } from '@/app/o/[organizationId]/links/sim-link-modal'
import { SimLinksEmptyState } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsListPagination } from '@/app/workspace/[workspaceId]/settings/components/settings-list-pagination'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useDeleteSimLink, useSimLinks } from '@/hooks/queries/sim-links'
import { useDebounce } from '@/hooks/use-debounce'

const logger = createLogger('SimLinks')

const SORT_TABS = [
  { id: 'name', label: 'A–Z' },
  { id: 'popular', label: 'Most used' },
] as const satisfies readonly OrganizationPageTab[]

async function copyLink(path: string) {
  try {
    await writeTextToClipboard(new URL(path, window.location.origin).href)
  } catch (error) {
    logger.error('Failed to copy Sim link', { error })
  }
}

interface SimLinkDetailsProps {
  link: SimLink
}

/** Who made the link, how often it is used, when it last changed, and how it is shared. */
function SimLinkDetails({ link }: SimLinkDetailsProps) {
  const details = [
    link.createdBy?.name,
    link.visitCount > 0 && `${link.visitCount} ${link.visitCount === 1 ? 'open' : 'opens'}`,
    formatRelativeTime(link.updatedAt),
  ].filter(Boolean)
  return (
    <>
      <span className='hidden text-[var(--text-muted)] text-caption sm:inline'>
        {details.join(' · ')}
      </span>
      {link.unlisted && <ChipTag>Unlisted</ChipTag>}
      {link.restrictEdit && <ChipTag>Restricted</ChipTag>}
    </>
  )
}

interface SimLinksProps {
  organizationId: string
}

/** Every Sim link the viewer may browse, with create, edit, and delete in place. */
export function SimLinks({ organizationId }: SimLinksProps) {
  const { search, tab } = useOrganizationPageFilters()
  const query = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const sort = tab === 'popular' ? 'popular' : 'name'
  const links = useSimLinks(organizationId, query, sort)
  const remove = useDeleteSimLink(organizationId)
  const [{ create }, setView] = useQueryStates(simLinkViewParsers)
  const [editing, setEditing] = useState<SimLink | null>(null)
  const [deleting, setDeleting] = useState<SimLink | null>(null)
  const rows = links.data?.pages.flatMap((page) => page.links) ?? []

  return (
    <OrganizationPage
      title='Sim Links'
      description='Short, shareable links that take your organization straight to the right page.'
      tabs={SORT_TABS}
      searchMode='expanded'
      searchPlaceholder='Search Sim links'
      action={
        <Chip leftIcon={Plus} onClick={() => void setView({ create: '' })}>
          New link
        </Chip>
      }
    >
      <div className={RESOURCE_LIST_STACK}>
        {links.isLoadingError ? (
          <SettingsQueryErrorState
            error={links.error}
            fallback='Could not load Sim links'
            isRetrying={links.isFetching}
            onRetry={() => void links.refetch()}
            variant='inline'
          />
        ) : !links.data ? (
          <SettingsEmptyState variant='inline'>Loading Sim links</SettingsEmptyState>
        ) : !rows.length && query ? (
          <SettingsEmptyState variant='inline'>No matching Sim links</SettingsEmptyState>
        ) : !rows.length ? (
          <SimLinksEmptyState onCreate={() => void setView({ create: '' })} />
        ) : (
          rows.map((link) => {
            const path = simLinkPath(link.name)
            return (
              <SettingsResourceRow
                key={link.id}
                icon={<Link />}
                title={`sim/${link.name}`}
                description={link.description ? `${link.description} · ${link.url}` : link.url}
                badge={<SimLinkDetails link={link} />}
                onClick={() => window.open(path, '_blank', 'noopener,noreferrer')}
                clickLabel={`Open sim/${link.name}`}
                trailing={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Chip leftIcon={MoreHorizontal} aria-label={`sim/${link.name} actions`} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem onSelect={() => void copyLink(path)}>
                        Copy link
                      </DropdownMenuItem>
                      {link.canEdit && (
                        <>
                          <DropdownMenuItem onSelect={() => setEditing(link)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className='text-[var(--text-error)]'
                            onSelect={() => {
                              remove.reset()
                              setDeleting(link)
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            )
          })
        )}
        <SettingsListPagination {...links} fallback='Could not load more Sim links' />
      </div>
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
    </OrganizationPage>
  )
}
