'use client'

import { createContext, useContext } from 'react'
import type { ShellActions, ShellData } from '@/app/(product)/_components/model'
import { useHydrated } from '@/hooks/use-hydrated'

export interface LiveShell {
  data: ShellData
  actions: ShellActions
}

interface LiveShellValue extends LiveShell {
  /**
   * The data as the provider first rendered it, which is what the server rendered: only reads
   * the server seeded are in it, since the browser has fetched nothing yet.
   */
  firstPaint: ShellData
}

/** The live shell, or `null` when the session is driven by fixtures or has no data. */
export const LiveShellContext = createContext<LiveShellValue | null>(null)

/**
 * The shell's data, as first painted until the calling component has hydrated. The provider sits
 * above the shell's Suspense boundary and hydrates first, so a read the server did not seed (an
 * empty workspace list is never seeded) can land before the sidebar hydrates; revealing it then
 * would paint server and client differently.
 */
export function useLiveShellData(): ShellData | null {
  const shell = useContext(LiveShellContext)
  const hydrated = useHydrated()
  if (!shell) return null
  return hydrated ? shell.data : shell.firstPaint
}

export function useLiveShellActions(): ShellActions | null {
  return useContext(LiveShellContext)?.actions ?? null
}
