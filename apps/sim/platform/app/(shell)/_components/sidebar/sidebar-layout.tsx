'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'

function useLayoutState() {
  const [collapsed, setCollapsed] = useState(false)
  const [order, setOrder] = useState('Recent activity')
  const [workspacesOpen, setWorkspacesOpen] = useState(true)
  const [chatsOpen, setChatsOpen] = useState(true)
  const [filter, setFilter] = useState('all')
  const [read, setRead] = useState<ReadonlySet<string>>(() => new Set())
  return {
    collapsed,
    setCollapsed,
    workspacesOpen,
    setWorkspacesOpen,
    chatsOpen,
    setChatsOpen,
    order,
    setOrder,
    filter,
    setFilter,
    read,
    setRead,
  }
}

const SidebarContext = createContext<ReturnType<typeof useLayoutState> | null>(null)

export function SidebarLayout({ children }: { children: ReactNode }) {
  const state = useLayoutState()
  return <SidebarContext.Provider value={state}>{children}</SidebarContext.Provider>
}

export function useSidebarLayout() {
  const state = useContext(SidebarContext)
  if (!state) throw new Error('The sidebar needs a product layout')
  return state
}
