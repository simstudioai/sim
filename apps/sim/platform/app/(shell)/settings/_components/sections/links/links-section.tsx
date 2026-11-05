'use client'

import { useState } from 'react'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { LinkEditor } from '@/platform/app/(shell)/settings/_components/sections/links/link-editor'
import { LinkIcon } from '@/platform/app/(shell)/settings/_components/sections/links/link-icon'
import styles from '@/platform/app/(shell)/settings/_components/sections/links/links-section.module.css'
import {
  ActionMenu,
  Avatar,
  Button,
  DataTable,
  EmptyState,
  Icon,
  InlineNotice,
  Modal,
  OverflowText,
  SearchField,
  Select,
} from '@/platform/design-system/components'
import { type LinkRow, useLinksSection } from '@/platform/lib/data/links'
import { formatCalendarDate } from '@/platform/lib/time'

const COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'destination', label: 'Destination', kind: 'text', showFrom: 'compact' },
  { key: 'description', label: 'Description', kind: 'text', showFrom: 'wide' },
  { key: 'owner', label: 'Created by', kind: 'text', showFrom: 'wide' },
  { key: 'access', label: 'Access', kind: 'text', showFrom: 'wide' },
  { key: 'updated', label: 'Updated', kind: 'text', showFrom: 'wide' },
] as const

const SKELETON_ROWS = 6

export default function LinksSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const links = useLinksSection(organizationId, organization.legacyOrigin)
  const [editing, setEditing] = useState<LinkRow | null>(null)
  const [deleting, setDeleting] = useState<LinkRow | null>(null)
  const [searchKey, setSearchKey] = useState(0)
  return (
    <>
      <div className={styles.actions}>
        {organization.deployment.hosted && (
          <Button icon='I041' onClick={links.openChromeStore}>
            Install Sim for Chrome
          </Button>
        )}
        <Button variant='primary' icon='I074' onClick={links.startCreate}>
          New link
        </Button>
      </div>
      <div className={styles.options}>
        <SearchField
          key={searchKey}
          label='Search links'
          placeholder='Search links…'
          defaultValue={links.search}
          onValueChange={links.setSearch}
        />
        <div className={styles.sort}>
          <Select
            label='Sort links'
            variant='quiet'
            options={links.sortOptions}
            value={links.sortValue}
            onValueChange={links.setSort}
          />
        </div>
      </div>
      {links.status === 'error' ? (
        <InlineNotice
          intent='danger'
          message={links.error ?? 'Failed to load links'}
          action={
            <Button variant='quiet' size='compact' onClick={links.retry}>
              Retry
            </Button>
          }
        />
      ) : links.status === 'pending' ? (
        <div role='status' aria-label='Loading links' className={styles.skeleton}>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <span key={index} className={styles.skeletonRow} />
          ))}
        </div>
      ) : links.rows.length === 0 ? (
        links.term ? (
          <EmptyState
            title={`No links match "${links.term}"`}
            description='Searched every link you can see.'
            action={
              <Button
                variant='quiet'
                onClick={() => {
                  links.setSearch('')
                  setSearchKey((key) => key + 1)
                }}
              >
                Clear search
              </Button>
            }
          />
        ) : (
          <EmptyState
            graphic={<Icon name='I041' />}
            title='Links'
            description='Create short links like handbook for the pages your team opens most.'
            action={
              <Button variant='primary' icon='I074' onClick={links.startCreate}>
                New link
              </Button>
            }
          />
        )
      ) : (
        <DataTable
          title='Links'
          titleHidden
          virtualized
          columns={COLUMNS}
          loadMore={links.loadMore}
          rows={links.rows.map((link) => ({
            id: link.id,
            values: {
              name: link.name,
              destination: link.url,
              description: link.description,
              owner: link.ownerName,
              access: link.access,
              updated: formatCalendarDate(link.updatedAt.slice(0, 10), 'full'),
            },
            cells: {
              name: (
                <span className={styles.name}>
                  <LinkIcon src={link.faviconSrc} />
                  <OverflowText text={link.name}>{link.name}</OverflowText>
                </span>
              ),
              destination: <OverflowText text={link.url}>{link.url}</OverflowText>,
              owner: link.ownerName ? (
                <span className={styles.name}>
                  <Avatar size='inline' name={link.ownerName} src={link.ownerImage ?? undefined} />
                  <OverflowText text={link.ownerName}>{link.ownerName}</OverflowText>
                </span>
              ) : undefined,
            },
            onOpen: () => links.open(link.name),
            action: (
              <ActionMenu
                label={`${link.name} actions`}
                align='end'
                actions={[
                  {
                    id: 'open',
                    label: 'Open',
                    onSelect: () => links.open(link.name),
                  },
                  {
                    id: 'copy',
                    label: 'Copy link',
                    onSelect: () => void links.copy(link.name),
                  },
                  ...(link.canEdit
                    ? [
                        {
                          id: 'edit',
                          label: 'Edit',
                          onSelect: () => setEditing(link),
                        },
                        {
                          id: 'delete',
                          label: 'Delete',
                          destructive: true,
                          separatorBefore: true,
                          onSelect: () => setDeleting(link),
                        },
                      ]
                    : []),
                ]}
              />
            ),
          }))}
        />
      )}
      {links.createName !== null && (
        <LinkEditor
          key={`create:${links.createName}`}
          organizationId={organizationId}
          initialName={links.createName}
          onClose={links.closeCreate}
          onDocs={links.openDocs}
        />
      )}
      {editing && (
        <LinkEditor
          key={editing.id}
          organizationId={organizationId}
          link={editing.source}
          onClose={() => setEditing(null)}
          onDocs={links.openDocs}
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
    </>
  )
}
