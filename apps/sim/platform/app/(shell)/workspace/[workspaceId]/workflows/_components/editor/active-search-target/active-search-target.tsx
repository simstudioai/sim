'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { ActiveSearchTarget } from '@/platform/lib/data/workflow-editor'

const ActiveSearchTargetContext = createContext<ActiveSearchTarget | null>(null)

interface ActiveSearchTargetProviderProps {
  value: ActiveSearchTarget | null
  children: ReactNode
}

/** The workflow search match inside the block the editor shows, for fields to highlight. */
export function ActiveSearchTargetProvider({ value, children }: ActiveSearchTargetProviderProps) {
  return (
    <ActiveSearchTargetContext.Provider value={value}>
      {children}
    </ActiveSearchTargetContext.Provider>
  )
}

export function useActiveSearchTarget(): ActiveSearchTarget | null {
  return useContext(ActiveSearchTargetContext)
}
