'use client'

import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { SectionSkeleton } from '@/platform/app/(shell)/settings/_components/section-skeleton/section-skeleton'
import { Button, EmptyState, InlineNotice, SearchField } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { useDeletedChats, useRestoreChat } from '@/platform/lib/data/recently-deleted'

const TITLE = 'Deleted chats'

function DeletedChatRow({
  organizationId,
  chat,
}: {
  organizationId: string
  chat: ReturnType<typeof useDeletedChats>['chats'][number]
}) {
  const restore = useRestoreChat(organizationId)
  return (
    <SettingsRow label={chat.name} description={chat.deleted}>
      <Button size='compact' disabled={restore.pending} onClick={() => restore.run(chat.id)}>
        {restore.pending ? 'Restoring' : 'Restore'}
      </Button>
    </SettingsRow>
  )
}

export default function RecentlyDeletedSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const deleted = useDeletedChats(organizationId)
  return (
    <>
      <SearchField
        label='Search deleted chats'
        placeholder='Search deleted chats'
        defaultValue={deleted.search}
        onValueChange={deleted.setSearch}
      />
      {deleted.status === 'error' ? (
        <InlineNotice
          intent='danger'
          message={deleted.error ?? 'Failed to load deleted chats'}
          action={
            <Button variant='quiet' size='compact' onClick={deleted.retry}>
              Retry
            </Button>
          }
        />
      ) : deleted.status === 'pending' ? (
        <SectionSkeleton title={TITLE} />
      ) : deleted.chats.length === 0 ? (
        <EmptyState title={deleted.hasAny ? 'No chats match your search' : 'No deleted chats'} />
      ) : (
        <SettingsSection title={TITLE}>
          {deleted.chats.map((chat) => (
            <DeletedChatRow key={chat.id} organizationId={organizationId} chat={chat} />
          ))}
        </SettingsSection>
      )}
    </>
  )
}
