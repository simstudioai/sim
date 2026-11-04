'use client'

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useState,
} from 'react'

type SidebarState = [boolean, Dispatch<SetStateAction<boolean>>]
const SidebarContext = createContext<SidebarState | null>(null)

export function SidebarLayout({ children }: { children: ReactNode }) {
  const state = useState(false)
  return <SidebarContext.Provider value={state}>{children}</SidebarContext.Provider>
}

export function useSidebarLayout() {
  const state = useContext(SidebarContext)
  if (!state) throw new Error('The sidebar needs a product layout')
  return state
}
