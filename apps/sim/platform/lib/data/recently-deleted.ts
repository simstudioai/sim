'use client'

import { formatDate } from '@sim/utils/formatting'
import { useQueryState } from 'nuqs'
import { parseAsString } from 'nuqs/server'
import {
  useOrganizationMothershipChats,
  useRestoreMothershipChat,
} from '@/hooks/queries/mothership-chats'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { toast } from '@/platform/lib/data/toast'

export function useDeletedChats(organizationId: string) {
  const [search, setSearchParam] = useQueryState(
    'search',
    parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true })
  )
  const setSearch = useDebouncedSearchSetter(setSearchParam)
  const chats = useOrganizationMothershipChats(organizationId, 'archived')
  const term = search.trim().toLowerCase()
  const all = chats.data ?? []
  return {
    status: chats.data ? 'success' : chats.status,
    error: chats.error?.message,
    retry: () => void chats.refetch(),
    search,
    setSearch,
    hasAny: all.length > 0,
    chats: all
      .filter((chat) => chat.name.toLowerCase().includes(term))
      .sort(
        (a, b) =>
          (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id)
      )
      .map((chat) => ({
        id: chat.id,
        name: chat.name,
        deleted: chat.deletedAt ? `Deleted ${formatDate(chat.deletedAt)}` : undefined,
      })),
  }
}

export function useRestoreChat(organizationId: string) {
  const restore = useRestoreMothershipChat({ organizationId })
  return {
    pending: restore.isPending,
    run: (chatId: string) =>
      restore.mutate(chatId, { onError: (error) => toast.error(error.message) }),
  }
}
