'use client'

import { compareStrings } from '@sim/utils/string'
import { toast } from '@/lib/toast/sink'
import {
  useOrganizationMothershipChats,
  useRestoreMothershipChat,
} from '@/hooks/queries/mothership-chats'
import { useSettingsSearch } from '@/hooks/use-settings-search'
import { queryView } from '@/platform/shared/query-view'
import { compareText, formatInstantDate } from '@/platform/shared/time'

export function useDeletedChats(organizationId: string) {
  const [search, setSearch] = useSettingsSearch()
  const chats = useOrganizationMothershipChats(organizationId, 'archived')
  const term = search.trim().toLowerCase()
  const all = chats.data ?? []
  return {
    ...queryView(chats),
    error: chats.error?.message,
    search,
    setSearch,
    hasAny: all.length > 0,
    chats: all
      .filter((chat) => chat.name.toLowerCase().includes(term))
      .sort(
        (a, b) =>
          (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0) ||
          compareText(a.name, b.name) ||
          compareStrings(a.id, b.id)
      )
      .map((chat) => ({
        id: chat.id,
        name: chat.name,
        deleted: chat.deletedAt ? `Deleted ${formatInstantDate(chat.deletedAt)}` : undefined,
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
