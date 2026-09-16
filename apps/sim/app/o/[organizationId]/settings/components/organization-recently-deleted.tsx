'use client'

import { Chip, toast } from '@sim/emcn'
import { Task } from '@sim/emcn/icons'
import { formatDate } from '@sim/utils/formatting'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import {
  type MothershipChatMetadata,
  useOrganizationMothershipChats,
  useRestoreMothershipChat,
} from '@/hooks/queries/mothership-chats'

interface DeletedChatRowProps {
  organizationId: string
  chat: MothershipChatMetadata
}

function DeletedChatRow({ organizationId, chat }: DeletedChatRowProps) {
  const { mutate: restoreChat, isPending } = useRestoreMothershipChat({ organizationId })
  return (
    <SettingsResourceRow
      icon={<Task />}
      title={chat.name}
      description={chat.deletedAt ? `Deleted ${formatDate(chat.deletedAt)}` : undefined}
      trailing={
        <Chip
          variant='primary'
          disabled={isPending}
          onClick={() => restoreChat(chat.id, { onError: (error) => toast.error(error.message) })}
        >
          {isPending ? 'Restoring...' : 'Restore'}
        </Chip>
      }
    />
  )
}

interface OrganizationRecentlyDeletedProps {
  organizationId: string
}

export function OrganizationRecentlyDeleted({ organizationId }: OrganizationRecentlyDeletedProps) {
  const [search, setSearch] = useSettingsSearch()
  const {
    data: chats = [],
    isLoading,
    error,
  } = useOrganizationMothershipChats(organizationId, 'archived')
  const searchTerm = search.trim().toLowerCase()
  const filtered = chats
    .filter((chat) => chat.name.toLowerCase().includes(searchTerm))
    .sort(
      (a, b) =>
        (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
    )

  return (
    <SettingsPanel
      search={{ value: search, onChange: setSearch, placeholder: 'Search deleted chats...' }}
    >
      {error ? (
        <SettingsEmptyState tone='error'>{error.message}</SettingsEmptyState>
      ) : isLoading ? null : filtered.length === 0 ? (
        <SettingsEmptyState>
          {searchTerm && chats.length > 0 ? 'No chats match your search' : 'No deleted chats'}
        </SettingsEmptyState>
      ) : (
        <div className={RESOURCE_LIST_STACK}>
          {filtered.map((chat) => (
            <DeletedChatRow key={chat.id} organizationId={organizationId} chat={chat} />
          ))}
        </div>
      )}
    </SettingsPanel>
  )
}
