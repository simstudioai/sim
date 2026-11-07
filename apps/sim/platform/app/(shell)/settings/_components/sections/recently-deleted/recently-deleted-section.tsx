'use client'

import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { useDeletedChats, useRestoreChat } from '@/platform/shared/recently-deleted'

const TITLE = 'Deleted chats'

interface DeletedChatRowProps {
  organizationId: string
  chat: ReturnType<typeof useDeletedChats>['chats'][number]
}

function DeletedChatRow({ organizationId, chat }: DeletedChatRowProps) {
  const restore = useRestoreChat(organizationId)
  return (
    <SettingsRow label={chat.name} description={chat.deleted} leading={<Icon name='I073' />}>
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
        value={deleted.search}
        onValueChange={deleted.setSearch}
      />
      {deleted.status === 'error' ? (
        <FailureNotice
          message={deleted.error ?? 'Failed to load deleted chats'}
          onRetry={deleted.retry}
        />
      ) : deleted.status === 'pending' ? (
        <SettingsSection title={TITLE} />
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
