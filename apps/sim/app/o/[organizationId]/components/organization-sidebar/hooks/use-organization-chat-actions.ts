import { useCallback, useEffect, useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { OrganizationChat } from '@/app/o/[organizationId]/components/organization-sidebar/hooks/use-organization-chats'
import { useFlyoutInlineRename } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-flyout-inline-rename'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu'
import {
  useMarkMothershipChatRead,
  useMarkMothershipChatUnread,
  useRenameMothershipChat,
  useSetMothershipChatPinned,
} from '@/hooks/queries/mothership-chats'
import { useContextMenu } from '@/hooks/use-context-menu'

interface UseOrganizationChatActionsProps {
  organizationId: string
  chats: OrganizationChat[]
}

export function useOrganizationChatActions({
  organizationId,
  chats,
}: UseOrganizationChatActionsProps) {
  const owner = { organizationId }
  const { mutateAsync: renameChat } = useRenameMothershipChat(owner)
  const { mutate: pinChat } = useSetMothershipChatPinned(owner)
  const { mutate: readChat } = useMarkMothershipChatRead(owner)
  const { mutate: unreadChat } = useMarkMothershipChatUnread(owner)
  const menu = useContextMenu()
  const hover = useHoverMenu()
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const selectedChat = chats.find((chat) => chat.id === selectedChatId)
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

  const onContextMenu = useCallback(
    (event: React.MouseEvent, chatId: string) => {
      setSelectedChatId(chatId)
      hover.setLocked(true)
      menu.preventDismiss()
      menu.handleContextMenu(event)
    },
    [hover.setLocked, menu.preventDismiss, menu.handleContextMenu]
  )

  const onMorePointerDown = useCallback(() => {
    if (menu.isOpen) menu.preventDismiss()
  }, [menu.isOpen, menu.preventDismiss])

  const onMoreClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, chatId: string) => {
      if (menu.isOpen && selectedChatId === chatId) {
        menu.closeMenu()
        return
      }
      const rect = event.currentTarget.getBoundingClientRect()
      setSelectedChatId(chatId)
      hover.setLocked(true)
      menu.openMenuAt({ x: rect.right, y: rect.top })
    },
    [menu.isOpen, menu.closeMenu, menu.openMenuAt, hover.setLocked, selectedChatId]
  )

  const chatId = selectedChat?.id
  const chatName = selectedChat?.name
  const chatHref = selectedChat?.href
  const chatPinned = selectedChat?.isPinned

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
    onContextMenu,
    onMorePointerDown,
    onMoreClick,
    startRename,
    togglePin,
    markRead,
    markUnread,
    openInNewTab,
    copyLink,
  }
}
