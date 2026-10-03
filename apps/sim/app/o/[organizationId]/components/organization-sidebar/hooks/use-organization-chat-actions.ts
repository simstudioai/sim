import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { OrganizationChat } from '@/app/o/[organizationId]/components/organization-sidebar/hooks/use-organization-chats'
import { useChatSelection } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-chat-selection'
import { useFlyoutInlineRename } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-flyout-inline-rename'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu'
import {
  MothershipChatDeleteError,
  useDeleteMothershipChat,
  useDeleteMothershipChats,
  useMarkMothershipChatRead,
  useMarkMothershipChatUnread,
  useRenameMothershipChat,
  useSetMothershipChatPinned,
} from '@/hooks/queries/mothership-chats'
import { useContextMenu } from '@/hooks/use-context-menu'
import { useFolderStore } from '@/stores/folders/store'

interface UseOrganizationChatActionsProps {
  organizationId: string
  chats: OrganizationChat[]
}

export function useOrganizationChatActions({
  organizationId,
  chats,
}: UseOrganizationChatActionsProps) {
  const router = useRouter()
  const owner = { organizationId }
  const deleteChat = useDeleteMothershipChat(owner)
  const deleteChats = useDeleteMothershipChats(owner)
  const isDeleting = deleteChat.isPending || deleteChats.isPending
  const { mutateAsync: renameChat } = useRenameMothershipChat(owner)
  const { mutate: pinChat } = useSetMothershipChatPinned(owner)
  const { mutate: readChat } = useMarkMothershipChatRead(owner)
  const { mutate: unreadChat } = useMarkMothershipChatUnread(owner)
  const menu = useContextMenu()
  const hover = useHoverMenu()
  const chatIds = useMemo(() => chats.map((chat) => chat.id), [chats])
  const { selectedChats, handleChatClick } = useChatSelection({ chatIds })
  const [menuSelection, setMenuSelection] = useState<{
    chatId: string
    chatIds: string[]
  } | null>(null)
  const [chatIdsToDelete, setChatIdsToDelete] = useState<string[]>([])
  const deleteTargetIds = new Set(chatIdsToDelete)
  const chatsToDelete = chats.filter((chat) => deleteTargetIds.has(chat.id))
  const selectedChat =
    menuSelection?.chatIds.length === 1
      ? chats.find((chat) => chat.id === menuSelection.chatId)
      : undefined
  const rename = useFlyoutInlineRename({
    itemType: 'chat',
    onSave: async (chatId, title) => {
      try {
        await renameChat({ chatId, title })
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to rename chat'))
        throw error
      }
    },
  })

  /** Keep the parent flyout open while its nested menu or rename field owns focus. */
  useEffect(() => {
    hover.setLocked(menu.isOpen || rename.editingId !== null)
  }, [menu.isOpen, rename.editingId, hover.setLocked])

  const captureSelection = useCallback(
    (chatId: string) => {
      const { selectedChats, selectChatOnly } = useFolderStore.getState()
      if (selectedChats.has(chatId)) {
        setMenuSelection({ chatId, chatIds: chatIds.filter((id) => selectedChats.has(id)) })
      } else {
        selectChatOnly(chatId)
        setMenuSelection({ chatId, chatIds: [chatId] })
      }
    },
    [chatIds]
  )

  const onContextMenu = useCallback(
    (event: React.MouseEvent, chatId: string) => {
      captureSelection(chatId)
      hover.setLocked(true)
      menu.preventDismiss()
      menu.handleContextMenu(event)
    },
    [captureSelection, hover.setLocked, menu.preventDismiss, menu.handleContextMenu]
  )

  const onMorePointerDown = useCallback(() => {
    if (menu.isOpen) menu.preventDismiss()
  }, [menu.isOpen, menu.preventDismiss])

  const onMoreClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, chatId: string) => {
      if (menu.isOpen && menuSelection?.chatId === chatId) {
        menu.closeMenu()
        return
      }
      const rect = event.currentTarget.getBoundingClientRect()
      captureSelection(chatId)
      hover.setLocked(true)
      menu.openMenuAt({ x: rect.right, y: rect.top })
    },
    [menu.isOpen, menu.closeMenu, menu.openMenuAt, hover.setLocked, menuSelection, captureSelection]
  )

  const chatId = selectedChat?.id
  const chatName = selectedChat?.name
  const chatHref = selectedChat?.href
  const chatPinned = selectedChat?.isPinned

  const startDelete = useCallback(() => {
    setChatIdsToDelete(menuSelection?.chatIds ?? [])
  }, [menuSelection])

  const cancelDelete = useCallback(() => {
    if (!isDeleting) setChatIdsToDelete([])
  }, [isDeleting])

  const confirmDelete = useCallback(() => {
    if (chatsToDelete.length === 0 || isDeleting) return
    const redirectIfDeleted = (ids: string[]) => {
      if (
        ids.some((id) => window.location.pathname === organizationRoutes(organizationId).chat(id))
      ) {
        router.push(organizationRoutes(organizationId).home)
      }
    }
    const options = {
      onSuccess: () => {
        setChatIdsToDelete([])
        useFolderStore.getState().clearChatSelection()
        redirectIfDeleted(chatIdsToDelete)
      },
      onError: (error: Error) => {
        if (error instanceof MothershipChatDeleteError) {
          const deletedIds = new Set(error.deletedChatIds)
          setChatIdsToDelete((ids) => ids.filter((id) => !deletedIds.has(id)))
          redirectIfDeleted(error.deletedChatIds)
        }
        toast.error(error.message)
      },
    }
    if (chatsToDelete.length === 1) {
      deleteChat.mutate(chatsToDelete[0].id, options)
    } else {
      deleteChats.mutate(
        chatsToDelete.map((chat) => chat.id),
        options
      )
    }
  }, [
    chatIdsToDelete,
    chatsToDelete,
    deleteChat.mutate,
    deleteChats.mutate,
    isDeleting,
    organizationId,
    router,
  ])

  const startRename = useCallback(() => {
    if (chatId && chatName !== undefined) rename.startRename({ id: chatId, name: chatName })
  }, [chatId, chatName, rename.startRename])

  const togglePin = useCallback(() => {
    if (!chatId) return
    pinChat({ chatId, pinned: !chatPinned }, { onError: (error) => toast.error(error.message) })
  }, [chatId, chatPinned, pinChat])

  const markRead = useCallback(() => {
    if (chatId) readChat(chatId, { onError: (error) => toast.error(error.message) })
  }, [chatId, readChat])

  const markUnread = useCallback(() => {
    if (chatId) unreadChat(chatId, { onError: (error) => toast.error(error.message) })
  }, [chatId, unreadChat])

  const openInNewTab = useCallback(() => {
    if (chatHref) window.open(chatHref, '_blank', 'noopener,noreferrer')
  }, [chatHref])

  const copyLink = useCallback(async () => {
    if (!chatHref) return
    try {
      await navigator.clipboard.writeText(new URL(chatHref, window.location.origin).href)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to copy link'))
    }
  }, [chatHref])

  return {
    menu,
    hover,
    rename,
    selectedChat,
    selectedChats,
    handleChatClick,
    menuOpenChatId: menu.isOpen ? menuSelection?.chatId : null,
    selectedCount: menuSelection?.chatIds.length ?? 0,
    onContextMenu,
    onMorePointerDown,
    onMoreClick,
    startRename,
    chatsToDelete,
    isDeleting,
    startDelete,
    cancelDelete,
    confirmDelete,
    togglePin,
    markRead,
    markUnread,
    openInNewTab,
    copyLink,
  }
}
