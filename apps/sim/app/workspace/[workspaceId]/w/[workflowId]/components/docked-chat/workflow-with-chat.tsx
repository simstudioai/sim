'use client'

import { useCallback, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Workflow from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow'
import { DockedChat } from './docked-chat'

/** Sentinel `?chat=` value for a docked chat that hasn't been created yet. */
const NEW_CHAT_PARAM = 'new'

interface DockState {
  open: boolean
  chatId?: string
}

/**
 * The workflow route's shell: chat is the constant on the left, the editor
 * owns the stage on the right. Opening a chat never leaves the page — the
 * pane docks beside the canvas and the chat id rides in `?chat=` so refresh
 * and deep links restore the split.
 */
export function WorkflowWithChat() {
  const { workspaceId, workflowId } = useParams<{ workspaceId: string; workflowId: string }>()
  const searchParams = useSearchParams()
  const initialChatParam = searchParams.get('chat')

  const [dock, setDock] = useState<DockState>(() =>
    initialChatParam
      ? {
          open: true,
          chatId: initialChatParam === NEW_CHAT_PARAM ? undefined : initialChatParam,
        }
      : { open: false }
  )

  /** URL is a mirror, not a router concern — replaceState avoids remounts. */
  const reflectChatParam = useCallback((value: string | null) => {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set('chat', value)
    else url.searchParams.delete('chat')
    window.history.replaceState(null, '', url.toString())
  }, [])

  const openChat = useCallback(
    (chatId?: string) => {
      setDock({ open: true, chatId })
      reflectChatParam(chatId ?? NEW_CHAT_PARAM)
    },
    [reflectChatParam]
  )

  const closeChat = useCallback(() => {
    setDock({ open: false })
    reflectChatParam(null)
  }, [reflectChatParam])

  /**
   * A new docked chat got its server id mid-conversation. Only the URL
   * updates — re-keying the pane here would remount the hook mid-stream.
   */
  const handleChatResolved = useCallback(
    (chatId: string) => reflectChatParam(chatId),
    [reflectChatParam]
  )

  if (!workspaceId || !workflowId) return null

  return (
    <div className='flex h-full w-full'>
      {dock.open && (
        <div className='flex h-full w-[clamp(360px,34%,520px)] flex-shrink-0 flex-col border-[var(--border)] border-r'>
          <DockedChat
            key={dock.chatId ?? 'new'}
            workspaceId={workspaceId}
            workflowId={workflowId}
            chatId={dock.chatId}
            onClose={closeChat}
            onSelectChat={openChat}
            onChatResolved={handleChatResolved}
          />
        </div>
      )}
      <div className='h-full min-w-0 flex-1'>
        <Workflow
          workspaceId={workspaceId}
          workflowId={workflowId}
          chatDock={{ isOpen: dock.open, onSelectChat: openChat }}
        />
      </div>
    </div>
  )
}
