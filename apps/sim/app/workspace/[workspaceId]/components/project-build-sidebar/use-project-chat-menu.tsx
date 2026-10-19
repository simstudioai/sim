'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { usePathname, useRouter } from 'next/navigation'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import type { SidebarChat } from '@/app/workspace/[workspaceId]/w/components/sidebar/use-workspace-sidebar-services'
import {
  useDeleteMothershipChat,
  useMarkMothershipChatRead,
  useMarkMothershipChatUnread,
  useRenameMothershipChat,
  useSetMothershipChatPinned,
} from '@/hooks/queries/mothership-chats'
import { useContextMenu } from '@/hooks/use-context-menu'

interface UseProjectChatMenuProps {
  workspaceId: string
  chats: SidebarChat[]
}

/** A chat row's menu in the project rail: the workspace sidebar's single-chat actions. */
export function useProjectChatMenu({ workspaceId, chats }: UseProjectChatMenuProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { canEdit } = useUserPermissionsContext()
  const { isOpen, position, menuRef, handleContextMenu, closeMenu } = useContextMenu()
  const [chatId, setChatId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const markRead = useMarkMothershipChatRead(workspaceId)
  const markUnread = useMarkMothershipChatUnread(workspaceId)
  const setPinned = useSetMothershipChatPinned(workspaceId)
  const renameChat = useRenameMothershipChat(workspaceId)
  const deleteChat = useDeleteMothershipChat(workspaceId)
  const chat = chats.find((candidate) => candidate.id === chatId)
  const chatHref = `/workspace/${workspaceId}/chat/${chatId}`

  const openMenu = (event: React.MouseEvent, id: string) => {
    setChatId(id)
    handleContextMenu(event)
  }

  const submitRename = async () => {
    const title = renameValue?.trim()
    if (!chat || !title) return
    try {
      await renameChat.mutateAsync({ chatId: chat.id, title })
      setRenameValue(null)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to rename chat'))
    }
  }

  const confirmDelete = () => {
    if (!chat) return
    const viewingDeleted = pathname === chatHref
    deleteChat.mutate(chat.id, {
      onSuccess: () => {
        if (viewingDeleted) router.push(`/workspace/${workspaceId}/home`)
      },
    })
    setConfirmingDelete(false)
  }

  const menu = (
    <>
      <ContextMenu
        isOpen={isOpen}
        position={position}
        menuRef={menuRef}
        onClose={closeMenu}
        onOpenInNewTab={() => window.open(chatHref, '_blank', 'noopener,noreferrer')}
        onMarkAsRead={() => chat && markRead.mutate(chat.id)}
        onMarkAsUnread={() => chat && markUnread.mutate(chat.id)}
        onTogglePin={() => chat && setPinned.mutate({ chatId: chat.id, pinned: !chat.isPinned })}
        onRename={() => chat && setRenameValue(chat.name)}
        onDelete={() => setConfirmingDelete(true)}
        showOpenInNewTab
        showMarkAsRead={Boolean(chat?.isUnread)}
        showMarkAsUnread={Boolean(chat) && !chat?.isUnread}
        showPin={Boolean(chat)}
        isPinned={Boolean(chat?.isPinned)}
        showRename
        showDuplicate={false}
        disableRename={!canEdit}
        disableDelete={!canEdit}
        selectedCount={1}
      />
      <ChipModal
        open={renameValue !== null}
        onOpenChange={(open) => !open && setRenameValue(null)}
        srTitle='Rename Chat'
      >
        <ChipModalHeader onClose={() => setRenameValue(null)}>Rename Chat</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='input'
            title='Name'
            value={renameValue ?? ''}
            onChange={setRenameValue}
            required
          />
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setRenameValue(null)}
          cancelDisabled={renameChat.isPending}
          primaryAction={{
            label: renameChat.isPending ? 'Saving...' : 'Save',
            onClick: () => void submitRename(),
            disabled: !renameValue?.trim() || renameChat.isPending,
          }}
        />
      </ChipModal>
      <DeleteModal
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={confirmDelete}
        isDeleting={deleteChat.isPending}
        itemType='task'
        itemName={chat?.name}
      />
    </>
  )

  return { openMenu, menu }
}
