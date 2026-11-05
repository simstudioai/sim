'use client'

import { type MouseEvent, memo, type ReactNode, type TouchEvent, useMemo, useState } from 'react'
import { LinkEditor } from '@/platform/app/(shell)/_components/links-page/link-editor'
import { LinkIcon } from '@/platform/app/(shell)/_components/links-page/link-icon'
import {
  LinkRowsSkeleton,
  LinksFrame,
} from '@/platform/app/(shell)/_components/links-page/links-frame'
import {
  ActionMenu,
  Avatar,
  Button,
  ContextActionMenu,
  DataTable,
  EmptyState,
  FailureNotice,
  Icon,
  Modal,
  OverflowText,
  TableLabel,
} from '@/platform/design-system/components'
import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'
import type { LoadMoreState } from '@/platform/design-system/components/scroll-area/use-load-more'
import { type LinkRecord, linkFaviconSrc, openLink, useLinksPage } from '@/platform/lib/data/links'
import { formatRelativeTime } from '@/platform/lib/time'

const COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'destination', label: 'Destination', kind: 'text', showFrom: 'compact' },
  { key: 'description', label: 'Description', kind: 'text', showFrom: 'wide' },
  { key: 'owner', label: 'Created by', kind: 'text', showFrom: 'wide' },
  { key: 'access', label: 'Access', kind: 'text', showFrom: 'wide' },
  { key: 'updated', label: 'Updated', kind: 'text', showFrom: 'wide' },
] as const

/** How the link is shared beyond the default: open to everyone and editable by any member. */
function accessLabel(link: LinkRecord): string | null {
  const limits = [link.unlisted && 'Unlisted', link.restrictEdit && 'Restricted'].filter(Boolean)
  return limits.length ? limits.join(', ') : null
}

/** The row's actions. `canEdit` gates both changes; `canManage` only gates the editor's Access. */
function linkActions(
  link: LinkRecord,
  { onCopy, onEdit, onDelete }: RowActions
): readonly MenuAction[] {
  return [
    { id: 'open', label: 'Open', icon: 'I030', onSelect: () => openLink(link.name) },
    { id: 'copy', label: 'Copy link', icon: 'I006', onSelect: () => void onCopy(link.name) },
    ...(link.canEdit
      ? ([
          { id: 'edit', label: 'Edit', icon: 'I036', onSelect: () => onEdit(link) },
          {
            id: 'delete',
            label: 'Delete',
            icon: 'I061',
            destructive: true,
            separatorBefore: true,
            onSelect: () => onDelete(link),
          },
        ] satisfies MenuAction[])
      : []),
  ]
}

interface RowActions {
  onCopy: (name: string) => Promise<void>
  onEdit: (link: LinkRecord) => void
  onDelete: (link: LinkRecord) => void
}

interface LinkRowContextMenuProps extends RowActions {
  links: readonly LinkRecord[]
  children: ReactNode
}

/**
 * One context menu serves the whole table, so the row under the pointer decides its actions. Off a
 * row, the event stops here: the browser keeps its own menu, as it does for a touch and hold. The
 * selection lives here so a touch on the table does not re-render its rows.
 */
function LinkRowContextMenu({ links, children, ...actions }: LinkRowContextMenuProps) {
  const [menuLinkId, setMenuLinkId] = useState<string | null>(null)
  const menuLink = links.find((link) => link.id === menuLinkId)

  const selectRowUnderPointer = (event: MouseEvent<HTMLElement> | TouchEvent<HTMLElement>) => {
    const row =
      event.target instanceof Element ? event.target.closest<HTMLElement>('tr[data-index]') : null
    const link = row ? links[Number(row.dataset.index)] : undefined
    if (link) setMenuLinkId(link.id)
    else event.stopPropagation()
  }

  return (
    <div onContextMenuCapture={selectRowUnderPointer} onTouchStartCapture={selectRowUnderPointer}>
      <ContextActionMenu
        label='Link actions'
        actions={menuLink ? linkActions(menuLink, actions) : []}
      >
        {children}
      </ContextActionMenu>
    </div>
  )
}

interface LinksTableProps extends RowActions {
  links: readonly LinkRecord[]
  loadMore: LoadMoreState
  /** The instant "Updated" counts back from. The rows render on the server, so it can't be the clock. */
  asOf: number | undefined
}

/** Memoized so a keystroke in the search field does not re-render every visible row. */
const LinksTable = memo(function LinksTable({
  links,
  loadMore,
  asOf,
  onCopy,
  onEdit,
  onDelete,
}: LinksTableProps) {
  const rows = useMemo(() => {
    const now = asOf ?? Date.now()
    return links.map((link) => {
      return {
        id: link.id,
        values: {
          access: accessLabel(link),
          updated: formatRelativeTime(new Date(link.updatedAt).getTime(), now),
        },
        cells: {
          name: (
            <TableLabel leading={<LinkIcon src={linkFaviconSrc(link)} />}>
              <OverflowText text={link.name}>{link.name}</OverflowText>
            </TableLabel>
          ),
          destination: <OverflowText text={link.url}>{link.url}</OverflowText>,
          description: link.description ? (
            <OverflowText text={link.description}>{link.description}</OverflowText>
          ) : undefined,
          owner: link.createdBy ? (
            <TableLabel
              leading={
                <Avatar
                  size='inline'
                  name={link.createdBy.name}
                  src={link.createdBy.image ?? undefined}
                />
              }
            >
              <OverflowText text={link.createdBy.name}>{link.createdBy.name}</OverflowText>
            </TableLabel>
          ) : undefined,
        },
        onOpen: () => openLink(link.name),
        action: (
          <ActionMenu
            label={`${link.name} actions`}
            icon='I108'
            align='end'
            actions={linkActions(link, { onCopy, onEdit, onDelete })}
          />
        ),
      }
    })
  }, [links, asOf, onCopy, onEdit, onDelete])

  return (
    <LinkRowContextMenu links={links} onCopy={onCopy} onEdit={onEdit} onDelete={onDelete}>
      <DataTable
        title='Links'
        titleHidden
        virtualized
        columns={COLUMNS}
        loadMore={loadMore}
        rows={rows}
      />
    </LinkRowContextMenu>
  )
})

interface LinksPageProps {
  organizationId: string
}

export function LinksPage({ organizationId }: LinksPageProps) {
  const links = useLinksPage(organizationId)
  const [editing, setEditing] = useState<LinkRecord | null>(null)
  const [deleting, setDeleting] = useState<LinkRecord | null>(null)

  return (
    <LinksFrame
      search={links.search}
      onSearch={links.setSearch}
      onCreate={links.startCreate}
      sortLabel={links.sortLabel}
      sortActions={links.sortActions}
    >
      {links.status === 'error' ? (
        <FailureNotice message={links.error ?? 'Failed to load links'} onRetry={links.retry} />
      ) : links.status === 'pending' || (links.isPlaceholder && links.rows.length === 0) ? (
        <LinkRowsSkeleton />
      ) : links.rows.length === 0 ? (
        links.term ? (
          <EmptyState
            title={`No results for “${links.term}”`}
            description='Searched every link you can see.'
            action={<Button onClick={() => links.setSearch('')}>Clear search</Button>}
          />
        ) : (
          <EmptyState
            graphic={<Icon name='I041' />}
            title='Links'
            description='Create short links like handbook for the pages your team opens most.'
            action={
              <Button variant='primary' onClick={links.startCreate}>
                New link
              </Button>
            }
          />
        )
      ) : (
        <LinksTable
          links={links.rows}
          loadMore={links.loadMore}
          asOf={links.asOf}
          onCopy={links.copy}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
      )}
      {links.createName !== null && (
        <LinkEditor
          key={links.createName}
          organizationId={organizationId}
          initialName={links.createName}
          onClose={links.closeCreate}
        />
      )}
      {editing && (
        <LinkEditor
          key={editing.id}
          organizationId={organizationId}
          link={editing}
          onClose={() => setEditing(null)}
        />
      )}
      <Modal
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        variant='confirm'
        destructive
        title='Delete link'
        confirmLabel='Delete'
        description={`${deleting?.name ?? 'This link'} will stop working for everyone in your organization.`}
        onConfirm={() => (deleting ? links.remove(deleting.id) : undefined)}
      />
    </LinksFrame>
  )
}
