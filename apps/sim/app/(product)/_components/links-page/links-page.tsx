'use client'

import { type MouseEvent, memo, type ReactNode, type TouchEvent, useMemo, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { DataTable, TableLabel } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { ActionMenu, ContextActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { OverflowText } from '@sim/emcn/overflow-text'
import type { LoadMoreState } from '@sim/emcn/scroll-area/use-load-more'
import { FailureNotice } from '@sim/emcn/status'
import { LinkEditor } from '@/app/(product)/_components/links-page/link-editor'
import { LinkIcon } from '@/app/(product)/_components/links-page/link-icon'
import { LinksFrame } from '@/app/(product)/_components/links-page/links-frame'
import styles from '@/app/(product)/_components/links-page/links-page.module.css'
import { useMinuteClock } from '@/app/(product)/_components/workspace/resource-table/rename-dialog'
import { type LinkRecord, linkFaviconSrc, openLink, useLinksPage } from '@/platform/lib/data/links'
import { formatRelativeTime } from '@/platform/shared/time'

const COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'destination', label: 'Destination', kind: 'text', showFrom: 'compact', share: '27%' },
  { key: 'description', label: 'Description', kind: 'text', showFrom: 'wide', share: '19%' },
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

interface LinkSummaryProps {
  link: LinkRecord
  updated: string
}

/**
 * What the table's hidden columns would say, under the name, so a narrow table loses nothing. Access
 * leads its line, where truncation cannot take it.
 */
function LinkSummary({ link, updated }: LinkSummaryProps) {
  const facts = [accessLabel(link), link.createdBy?.name, updated].filter(Boolean).join(' · ')
  return (
    <span className={styles.summary} data-type='T052'>
      <span className={styles.summaryDestination}>
        <OverflowText text={link.url}>{link.url}</OverflowText>
      </span>
      {link.description && <OverflowText text={link.description}>{link.description}</OverflowText>}
      <OverflowText text={facts}>{facts}</OverflowText>
    </span>
  )
}

interface LinksTableProps extends RowActions {
  links: readonly LinkRecord[]
  loadMore: LoadMoreState
  /** The instant "Updated" counts back from, read with the rows; placeholder rows use the list clock. */
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
  const clock = useMinuteClock()
  const now = asOf ?? clock
  const rows = useMemo(() => {
    return links.map((link) => {
      const updated = formatRelativeTime(new Date(link.updatedAt).getTime(), now)
      return {
        id: link.id,
        values: {
          access: accessLabel(link),
          updated,
        },
        cells: {
          name: (
            <TableLabel leading={<LinkIcon src={linkFaviconSrc(link)} />}>
              <span className={styles.nameCell}>
                <OverflowText text={link.name}>{link.name}</OverflowText>
                <LinkSummary link={link} updated={updated} />
              </span>
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
  }, [links, now, onCopy, onEdit, onDelete])

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
  const unsettled = links.status === 'pending' || (links.isPlaceholder && links.rows.length === 0)

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
      ) : unsettled ? null : links.rows.length === 0 ? (
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
