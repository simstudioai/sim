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
import { useQueryStates } from 'nuqs'
import type { SimLink } from '@/lib/api/contracts/sim-links'
import { simLinkPath } from '@/lib/navigation/paths'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  OrganizationPage,
  useOrganizationPageFilters,
} from '@/app/o/[organizationId]/components/organization-page'
import { simLinkViewParsers } from '@/app/o/[organizationId]/links/search-params'
import { SimLinkModal } from '@/app/o/[organizationId]/links/sim-link-modal'
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

/** Every Sim link the viewer may browse, with create, edit, and delete in place. */
export function SimLinks({ organizationId }: SimLinksProps) {
  const { search } = useOrganizationPageFilters()
  const query = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const links = useSimLinks(organizationId, query)
  const remove = useDeleteSimLink(organizationId)
  const [{ create }, setView] = useQueryStates(simLinkViewParsers)
  const [editing, setEditing] = useState<SimLink | null>(null)
  const [deleting, setDeleting] = useState<SimLink | null>(null)
  const rows = links.data?.pages.flatMap((page) => page.links) ?? []

  return (
    <OrganizationPage
      title='Sim Links'
      description='Short, shareable links that take your organization straight to the right page.'
      searchMode='expanded'
      searchPlaceholder='Search Sim links'
      action={
        <Chip leftIcon={Plus} onClick={() => void setView({ create: '' })}>
          New link
        </Chip>
      }
    >
      <div className={RESOURCE_LIST_STACK}>
        {links.error ? (
          <SettingsQueryErrorState
            error={links.error}
            fallback='Could not load Sim links'
            isRetrying={links.isFetching}
            onRetry={() => void links.refetch()}
            variant='inline'
          />
        ) : !links.data ? (
          <SettingsEmptyState variant='inline'>Loading Sim links</SettingsEmptyState>
        ) : !rows.length ? (
          <SettingsEmptyState variant='inline'>
            {query ? 'No matching Sim links' : 'No Sim links yet'}
          </SettingsEmptyState>
        ) : (
          rows.map((link) => (
            <SettingsResourceRow
              key={link.id}
              icon={<Link />}
              title={`sim/${link.name}`}
              description={link.url}
              badge={link.unlisted && <ChipTag>Unlisted</ChipTag>}
              onClick={() => window.open(simLinkPath(link.name), '_blank', 'noopener,noreferrer')}
              clickLabel={`Open sim/${link.name}`}
              trailing={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Chip leftIcon={MoreHorizontal} aria-label={`sim/${link.name} actions`} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuItem onSelect={() => void copyLink(link.name)}>
                      Copy link
                    </DropdownMenuItem>
                    {link.canEdit && (
                      <>
                        <DropdownMenuItem onSelect={() => setEditing(link)}>Edit</DropdownMenuItem>
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
          ))
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
