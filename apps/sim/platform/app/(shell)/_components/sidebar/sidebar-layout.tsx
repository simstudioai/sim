'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import type { SidebarOrder } from '@/platform/app/(shell)/_components/sidebar/collection-order'

const COLLAPSED_COOKIE_MAX_AGE_SECONDS = 31536000

/** `initialCollapsed` is the cookie the server read; without one, collapse lasts for this session. */
function useLayoutState(initialCollapsed: boolean | undefined) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed ?? false)
  const [workspaceOrder, setWorkspaceOrder] = useState<SidebarOrder>('recent')
  const [chatOrder, setChatOrder] = useState<SidebarOrder>('recent')
  const [workspacesOpen, setWorkspacesOpen] = useState(true)
  const [chatsOpen, setChatsOpen] = useState(true)
  const [filter, setFilter] = useState('all')
  const [read, setRead] = useState<ReadonlySet<string>>(() => new Set())
  function setCollapsed(next: boolean) {
    setCollapsedState(next)
    if (initialCollapsed !== undefined)
      document.cookie = `sidebar_collapsed=${next ? '1' : '0'}; path=/; max-age=${COLLAPSED_COOKIE_MAX_AGE_SECONDS}; samesite=lax`
  }
  return {
    collapsed,
    setCollapsed,
    workspacesOpen,
    setWorkspacesOpen,
    chatsOpen,
    setChatsOpen,
    workspaceOrder,
    setWorkspaceOrder,
    chatOrder,
    setChatOrder,
    filter,
    setFilter,
    read,
    setRead,
  }
}

const SidebarContext = createContext<ReturnType<typeof useLayoutState> | null>(null)

interface SidebarLayoutProps {
  initialCollapsed?: boolean
  children: ReactNode
}

export function SidebarLayout({ initialCollapsed, children }: SidebarLayoutProps) {
  const state = useLayoutState(initialCollapsed)
  return <SidebarContext.Provider value={state}>{children}</SidebarContext.Provider>
}

export function useSidebarLayout() {
  const state = useContext(SidebarContext)
  if (!state) throw new Error('The sidebar needs a product layout')
  return state
}
