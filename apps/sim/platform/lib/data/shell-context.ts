'use client'

import { createContext, useContext } from 'react'
import type { ShellData } from '@/platform/app/(shell)/_components/model'

/** Live shell data, or `null` when the session is driven by fixtures or has no data. */
export const LiveShellContext = createContext<ShellData | null>(null)

export function useLiveShellData(): ShellData | null {
  return useContext(LiveShellContext)
}
