'use client'

import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { SectionSearch } from '@sim/emcn/search-field/section-search'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { QueryBoundary } from '@sim/emcn/status/query-boundary'
import { SectionSkeleton } from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
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
      <SectionSearch
        subject='deleted chats'
        value={deleted.search}
        onValueChange={deleted.setSearch}
      />
      <QueryBoundary
        query={{
          data:
            deleted.status === 'error' || deleted.status === 'pending' ? undefined : deleted.chats,
          error: deleted.status === 'error',
          refetch: deleted.retry,
        }}
        failure={deleted.error ?? 'Failed to load deleted chats'}
        loadingLabel={`Loading ${TITLE}`}
        loading={<SectionSkeleton title={TITLE} />}
      >
        {() =>
          deleted.chats.length === 0 ? (
            <EmptyState
              title={deleted.hasAny ? 'No chats match your search' : 'No deleted chats'}
            />
          ) : (
            <SettingsSection title={TITLE}>
              {deleted.chats.map((chat) => (
                <DeletedChatRow key={chat.id} organizationId={organizationId} chat={chat} />
              ))}
            </SettingsSection>
          )
        }
      </QueryBoundary>
    </>
  )
}
