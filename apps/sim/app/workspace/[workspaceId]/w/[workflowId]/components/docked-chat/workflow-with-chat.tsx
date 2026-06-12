'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
import Workflow from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow'
import { DockedChat } from './docked-chat'

/** Sentinel `?chat=` value for a docked chat that hasn't been created yet. */
const NEW_CHAT_PARAM = 'new'

/** Drag bounds for the docked chat pane. */
const CHAT_PANE = { MIN: 360, MAX_PERCENTAGE: 0.55 } as const

interface DockState {
  open: boolean
  chatId?: string
}

/**
 * The workflow route's shell: chat is the constant on the left, the editor
 * owns the stage on the right. Opening a chat never leaves the page — the
 * pane docks beside the canvas and the chat id rides in `?chat=` so refresh
 * and deep links restore the split. Non-workflow resources the chat touches
 * stage on the home surface's single resource panel (the chat follows along),
 * so the editor is only ever swapped for another full view — never stacked.
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
  const reflectParam = useCallback((key: string, value: string | null) => {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
    window.history.replaceState(null, '', url.toString())
  }, [])

  /** The chat actually in the pane (server id once a new chat resolves). */
  const activeChatIdRef = useRef<string | undefined>(dock.chatId)

  const openChat = useCallback(
    (chatId?: string) => {
      setDock({ open: true, chatId })
      activeChatIdRef.current = chatId
      reflectParam('chat', chatId ?? NEW_CHAT_PARAM)
    },
    [reflectParam]
  )

  const closeChat = useCallback(() => {
    setDock({ open: false })
    reflectParam('chat', null)
  }, [reflectParam])

  /**
   * A new docked chat got its server id mid-conversation. Only the URL
   * updates — re-keying the pane here would remount the hook mid-stream.
   */
  const handleChatResolved = useCallback(
    (chatId: string) => {
      activeChatIdRef.current = chatId
      reflectParam('chat', chatId)
    },
    [reflectParam]
  )

  // Divider drag mirrors useMothershipResize (imperative width, pointer
  // capture, zero re-renders) but measures from the pane's LEFT edge — this
  // pane leads the row instead of trailing it.
  const chatPaneRef = useRef<HTMLDivElement | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const el = chatPaneRef.current
    if (!el) return

    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    el.style.width = `${el.getBoundingClientRect().width}px`
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const ac = new AbortController()
    const { signal } = ac
    const cleanup = () => {
      ac.abort()
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragCleanupRef.current = null
    }
    dragCleanupRef.current = cleanup

    handle.addEventListener(
      'pointermove',
      (moveEvent: PointerEvent) => {
        const newWidth = moveEvent.clientX - el.getBoundingClientRect().left
        const maxWidth = window.innerWidth * CHAT_PANE.MAX_PERCENTAGE
        el.style.width = `${Math.min(Math.max(newWidth, CHAT_PANE.MIN), maxWidth)}px`
      },
      { signal }
    )
    handle.addEventListener(
      'pointerup',
      (upEvent: PointerEvent) => {
        handle.releasePointerCapture(upEvent.pointerId)
        cleanup()
      },
      { signal }
    )
    handle.addEventListener('pointercancel', cleanup, { signal })
  }, [])

  useEffect(() => () => dragCleanupRef.current?.(), [])

  useEffect(() => {
    const handleWindowResize = () => {
      const el = chatPaneRef.current
      if (!el || !el.style.width) return
      const maxWidth = window.innerWidth * CHAT_PANE.MAX_PERCENTAGE
      if (el.getBoundingClientRect().width > maxWidth) {
        el.style.width = `${maxWidth}px`
      }
    }
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  if (!workspaceId || !workflowId) return null

  return (
    <div className='flex h-full w-full'>
      {dock.open && (
        <>
          <div
            ref={chatPaneRef}
            className='flex h-full w-[clamp(360px,34%,520px)] flex-shrink-0 flex-col border-[var(--border)] border-r'
          >
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
          {/* Zero-width flex child whose absolute child straddles the border.
              A small grab pill fades in on hover so the affordance is
              discoverable without adding a permanent line. */}
          <div className='relative z-40 w-0 flex-none'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <div
                  className='group absolute inset-y-0 left-[-4px] flex w-[8px] cursor-ew-resize items-center justify-center'
                  role='separator'
                  aria-orientation='vertical'
                  aria-label='Resize chat pane'
                  onPointerDown={handleResizePointerDown}
                >
                  <div className='h-[48px] w-[4px] rounded-full bg-[var(--text-subtle)] opacity-0 transition-opacity hover-hover:group-hover:opacity-100' />
                </div>
              </Tooltip.Trigger>
              <Tooltip.Content side='right'>
                <p>Resize</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
        </>
      )}
      <div className='relative h-full min-w-0 flex-1'>
        <Workflow
          workspaceId={workspaceId}
          workflowId={workflowId}
          chatDock={{ isOpen: dock.open, onSelectChat: openChat }}
        />
      </div>
    </div>
  )
}
