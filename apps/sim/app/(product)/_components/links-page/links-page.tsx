'use client'

import { memo, useMemo, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { DataTable, TableLabel } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { OverflowText } from '@sim/emcn/overflow-text'
import type { LoadMoreState } from '@sim/emcn/scroll-area/use-load-more'
import { SearchField } from '@sim/emcn/search-field'
import { FailureNotice } from '@sim/emcn/status'
import { LinkEditor } from '@/app/(product)/_components/links-page/link-editor'
import { accessLabel, LinkNameCell } from '@/app/(product)/_components/links-page/link-name-cell'
import {
  LinkRowContextMenu,
  linkActions,
  type RowActions,
} from '@/app/(product)/_components/links-page/link-row-menu'
import styles from '@/app/(product)/_components/links-page/links-page.module.css'
import { SectionToolbar } from '@/app/(product)/_components/settings-parts/settings-parts'
import { useMinuteClock } from '@/platform/lib/data/clock'
import {
  type LinkRecord,
  openChromeStore,
  openLink,
  useLinksHosted,
  useLinksPage,
} from '@/platform/lib/data/links'
import { formatRelativeTime } from '@/platform/shared/time'

const COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'destination', label: 'Destination', kind: 'text', showFrom: 'compact', share: '27%' },
  { key: 'description', label: 'Description', kind: 'text', showFrom: 'wide', share: '19%' },
  { key: 'owner', label: 'Created by', kind: 'text', showFrom: 'wide' },
  { key: 'access', label: 'Access', kind: 'text', showFrom: 'wide' },
  { key: 'updated', label: 'Updated', kind: 'text', showFrom: 'wide' },
] as const

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
          name: <LinkNameCell link={link} updated={updated} />,
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

/**
 * Links' toolbar (search, sort and its actions), painted before the first read of links settles.
 * Links is a Settings section, so the Settings screen owns the page's column, landmark and one
 * heading. Search and sort leave once the settled list turns out to be empty.
 */
export function LinksPage({ organizationId }: LinksPageProps) {
  const links = useLinksPage(organizationId)
  const hosted = useLinksHosted()
  const [editing, setEditing] = useState<LinkRecord | null>(null)
  const [deleting, setDeleting] = useState<LinkRecord | null>(null)
  const unsettled = links.status === 'pending' || (links.isPlaceholder && links.rows.length === 0)

  const settledEmpty = !unsettled && links.status !== 'error' && links.rows.length === 0
  const searchable = !settledEmpty || Boolean(links.term)

  return (
    <div className={styles.page}>
      <SectionToolbar
        grow={
          searchable && (
            <SearchField
              label='Search links'
              placeholder='Search links…'
              value={links.search}
              onValueChange={links.setSearch}
            />
          )
        }
      >
        {searchable && (
          <ActionMenu
            label={links.sortLabel}
            icon={null}
            triggerSize='compact'
            align='end'
            actions={links.sortActions}
          />
        )}
        {hosted && (
          <Button icon='I041' onClick={openChromeStore}>
            Install Sim for Chrome
          </Button>
        )}
        <Button variant='primary' icon='I074' onClick={links.startCreate}>
          New link
        </Button>
      </SectionToolbar>
      {links.status === 'error' ? (
        <FailureNotice message={links.error ?? 'Failed to load links'} onRetry={links.retry} />
      ) : unsettled ? null : links.rows.length === 0 ? (
        links.term ? (
          <EmptyState
            title='No matching links'
            description='Searched every link you can see'
            action={<Button onClick={() => links.setSearch('')}>Clear search</Button>}
          />
        ) : (
          <EmptyState
            graphic={<Icon name='I041' />}
            title='Links'
            description='Create short links like handbook for the pages your team opens most'
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
      <ConfirmDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        title={({ name }) => `Delete ${name}`}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        description='It will stop working for everyone in your organization.'
        onConfirm={(link) => links.remove(link.id)}
      />
    </div>
  )
}
