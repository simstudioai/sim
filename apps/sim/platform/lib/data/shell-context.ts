'use client'

import { createContext, useContext } from 'react'
import type { ShellActions, ShellData } from '@/app/(product)/_components/model'

export interface LiveShell {
  data: ShellData
  actions: ShellActions
}

/** The live shell, or `null` when the session is driven by fixtures or has no data. */
export const LiveShellContext = createContext<LiveShell | null>(null)

export function useLiveShellData(): ShellData | null {
  return useContext(LiveShellContext)?.data ?? null
}

export function useLiveShellActions(): ShellActions | null {
  return useContext(LiveShellContext)?.actions ?? null
}
