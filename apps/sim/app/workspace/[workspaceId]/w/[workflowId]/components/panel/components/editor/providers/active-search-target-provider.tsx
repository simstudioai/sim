'use client'

import type React from 'react'
import { createContext, use } from 'react'
import type { ActiveSearchTarget } from '@/stores/panel/editor/store'

const ActiveSearchTargetContext = createContext<ActiveSearchTarget | null>(null)

interface ActiveSearchTargetProviderProps {
  value: ActiveSearchTarget | null
  children: React.ReactNode
}

/**
 * Provides the active workflow-search target to the panel editor sub-block tree.
 *
 * @remarks
 * The editor provides the target scoped to the currently edited block. Components
 * that project sub-block values into synthetic sub-blocks (e.g. tool-input params)
 * re-provide a transformed target so nested inputs receive the rewritten
 * `subBlockId`/`valuePath`. Outside any provider (e.g. preview), consumers see
 * `null`, which disables search highlighting.
 */
export function ActiveSearchTargetProvider({ value, children }: ActiveSearchTargetProviderProps) {
  return (
    <ActiveSearchTargetContext.Provider value={value}>
      {children}
    </ActiveSearchTargetContext.Provider>
  )
}

/**
 * Returns the active workflow-search target for the nearest editor scope, or
 * `null` when no search target applies (no provider, or target outside scope).
 */
export function useActiveSearchTarget(): ActiveSearchTarget | null {
  return use(ActiveSearchTargetContext)
}
