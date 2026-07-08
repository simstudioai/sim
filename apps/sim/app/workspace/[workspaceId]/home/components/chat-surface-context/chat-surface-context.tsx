'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { noop } from '@sim/utils/helpers'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import type { ChatContext } from '@/stores/panel'

/**
 * Identity and interaction callbacks shared across a Mothership chat surface
 * (home conversation view, home initial view, copilot panel). Carried via
 * context so leaf components (UserInput, MessageContent, MessageActions) can
 * consume them without relaying through every intermediate component.
 */
interface ChatSurfaceContextValue {
  /** Resolved id of the chat backing this surface, if one exists yet. */
  chatId?: string
  /** Id of the user interacting with this surface. */
  userId?: string
  /** Notifies the surface owner that a context chip was added to the input. */
  onContextAdd: (context: ChatContext) => void
  /** Notifies the surface owner that a context chip was removed from the input. */
  onContextRemove: (context: ChatContext) => void
  /** Opens a workspace resource referenced from rendered message content. */
  onWorkspaceResourceSelect: (resource: MothershipResource) => void
}

const ChatSurfaceContext = createContext<ChatSurfaceContextValue>({
  onContextAdd: noop,
  onContextRemove: noop,
  onWorkspaceResourceSelect: noop,
})

interface ChatSurfaceProviderProps {
  chatId?: string
  userId?: string
  onContextAdd?: (context: ChatContext) => void
  onContextRemove?: (context: ChatContext) => void
  onWorkspaceResourceSelect?: (resource: MothershipResource) => void
  children: ReactNode
}

/**
 * Provides the chat-surface identity and interaction callbacks to descendants.
 * Callbacks are latched in refs and exposed as stable wrappers so the memoized
 * context value only changes when `chatId` or `userId` change — consumers do
 * not re-render when a parent re-creates a handler.
 */
export function ChatSurfaceProvider({
  chatId,
  userId,
  onContextAdd,
  onContextRemove,
  onWorkspaceResourceSelect,
  children,
}: ChatSurfaceProviderProps) {
  const onContextAddRef = useRef(onContextAdd)
  const onContextRemoveRef = useRef(onContextRemove)
  const onWorkspaceResourceSelectRef = useRef(onWorkspaceResourceSelect)

  useLayoutEffect(() => {
    onContextAddRef.current = onContextAdd
    onContextRemoveRef.current = onContextRemove
    onWorkspaceResourceSelectRef.current = onWorkspaceResourceSelect
  })

  const stableOnContextAdd = useCallback((context: ChatContext) => {
    onContextAddRef.current?.(context)
  }, [])
  const stableOnContextRemove = useCallback((context: ChatContext) => {
    onContextRemoveRef.current?.(context)
  }, [])
  const stableOnWorkspaceResourceSelect = useCallback((resource: MothershipResource) => {
    onWorkspaceResourceSelectRef.current?.(resource)
  }, [])

  const value = useMemo<ChatSurfaceContextValue>(
    () => ({
      chatId,
      userId,
      onContextAdd: stableOnContextAdd,
      onContextRemove: stableOnContextRemove,
      onWorkspaceResourceSelect: stableOnWorkspaceResourceSelect,
    }),
    [chatId, userId, stableOnContextAdd, stableOnContextRemove, stableOnWorkspaceResourceSelect]
  )

  return <ChatSurfaceContext.Provider value={value}>{children}</ChatSurfaceContext.Provider>
}

/**
 * Reads the surrounding chat surface. Outside a provider this returns no-op
 * callbacks and undefined identity, matching the previous optional-prop
 * behavior.
 */
export function useChatSurface(): ChatSurfaceContextValue {
  return useContext(ChatSurfaceContext)
}
