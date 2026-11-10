'use client'

import {
  type ComponentType,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { noop } from '@sim/utils/helpers'
import type { SearchIntegrationConnectionProps } from '@/components/mothership-chat/message-content/components/special-tags/search-integration-connection'
import type { ShareDialogProps } from '@/components/share-modal'
import type {
  MessageActionsModel,
  PageContextDialogProps,
  WorkspaceResourceRef,
} from '@/lib/mothership/chat/types'
import { inter } from '@/app/_styles/fonts/inter/inter'

/**
 * How a host draws the shared chat: its typeface, its class names and the parts it replaces. Set once
 * around the whole chat, since context also reaches what the chat portals out of its own tree. A host
 * that sets nothing gets the workspace's own look.
 */
interface ChatChrome {
  fontClassName: string
  panelClassName?: string
  tabsClassName?: string
  sourcesClassName?: string
  userBubbleClassName?: string
  /** The reply's action row: copy, votes, fork, and sources. */
  responseActionsClassName?: string
  sourcesPopoverClassName?: string
  /** Holds the transcript's place while the history loads. */
  loadingTranscript?: ReactNode
  /** Holds the composer's place while the history loads. */
  loadingComposer?: ReactNode
  /** Draws a reply's action row in place of the default one. `MessageActions` keeps its behavior. */
  ResponseActionsComponent?: ComponentType<MessageActionsModel>
  /** Draws the open page-context dialog in place of the default one. */
  PageContextDialogComponent?: ComponentType<PageContextDialogProps>
  /** Draws the share dialog in place of the default one. `useShareDialog` keeps its behavior. */
  ShareDialogComponent?: ComponentType<ShareDialogProps>
}

const ChatChromeContext = createContext<ChatChrome>({ fontClassName: inter.className })

export function useChatChrome() {
  return useContext(ChatChromeContext)
}

/**
 * Identity and interaction callbacks shared across a Mothership chat surface
 * (home conversation view, home initial view, copilot panel). Carried via
 * context so leaf components (UserInput, MessageContent, MessageActions) can
 * consume them without relaying through every intermediate component.
 */
interface ChatSurfaceContextValue {
  SearchConnectionComponent?: ComponentType<SearchIntegrationConnectionProps>
  /** Resolved id of the chat backing this surface, if one exists yet. */
  chatId?: string
  /** Id of the user interacting with this surface. */
  userId?: string
  onViewSources?: (messageId: string, requestId?: string) => void
  onNavigateToChat?: (chatId: string) => void
  /** Opens a workspace resource referenced from rendered message content. */
  onWorkspaceResourceSelect: (resource: WorkspaceResourceRef) => void
}

const ChatSurfaceContext = createContext<ChatSurfaceContextValue>({
  onWorkspaceResourceSelect: noop,
})

interface ChatSurfaceProviderProps {
  SearchConnectionComponent?: ComponentType<SearchIntegrationConnectionProps>
  chatId?: string
  userId?: string
  onViewSources?: (messageId: string, requestId?: string) => void
  onNavigateToChat?: (chatId: string) => void
  onWorkspaceResourceSelect?: (resource: WorkspaceResourceRef) => void
  children: ReactNode
}

/**
 * Provides the chat-surface identity and interaction callbacks to descendants.
 * Callbacks are latched in refs and exposed as stable wrappers so the memoized
 * callback identities remain stable when a parent re-creates a handler.
 */
export function ChatSurfaceProvider({
  SearchConnectionComponent,
  chatId,
  userId,
  onWorkspaceResourceSelect,
  onViewSources,
  onNavigateToChat,
  children,
}: ChatSurfaceProviderProps) {
  const onViewSourcesRef = useRef(onViewSources)
  const hasSourcePanel = Boolean(onViewSources)
  const hasChatNavigation = Boolean(onNavigateToChat)
  const onNavigateToChatRef = useRef(onNavigateToChat)
  const onWorkspaceResourceSelectRef = useRef(onWorkspaceResourceSelect)

  useLayoutEffect(() => {
    onViewSourcesRef.current = onViewSources
    onNavigateToChatRef.current = onNavigateToChat
    onWorkspaceResourceSelectRef.current = onWorkspaceResourceSelect
  })

  const stableOnWorkspaceResourceSelect = useCallback((resource: WorkspaceResourceRef) => {
    onWorkspaceResourceSelectRef.current?.(resource)
  }, [])

  const stableOnViewSources = useCallback((messageId: string, requestId?: string) => {
    onViewSourcesRef.current?.(messageId, requestId)
  }, [])
  const stableOnNavigateToChat = useCallback((chatId: string) => {
    onNavigateToChatRef.current?.(chatId)
  }, [])

  const value = useMemo<ChatSurfaceContextValue>(
    () => ({
      onViewSources: hasSourcePanel ? stableOnViewSources : undefined,
      onNavigateToChat: hasChatNavigation ? stableOnNavigateToChat : undefined,
      SearchConnectionComponent,
      chatId,
      userId,
      onWorkspaceResourceSelect: stableOnWorkspaceResourceSelect,
    }),
    [
      hasSourcePanel,
      hasChatNavigation,
      stableOnNavigateToChat,
      stableOnViewSources,
      SearchConnectionComponent,
      chatId,
      userId,
      stableOnWorkspaceResourceSelect,
    ]
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
