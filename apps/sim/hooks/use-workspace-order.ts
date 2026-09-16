'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { WorkspaceRecencyStorage } from '@/lib/core/utils/browser-storage'
import type { Workspace } from '@/hooks/queries/workspace'

const serverSnapshot = () => null

/** Layers the viewer's pins and visit history over the server's newest-first list. */
export function useWorkspaceOrder(workspaces: Workspace[], pinnedIds: ReadonlySet<string>) {
  const recencySnapshot = useSyncExternalStore(
    WorkspaceRecencyStorage.subscribe,
    WorkspaceRecencyStorage.getSnapshot,
    serverSnapshot
  )
  return useMemo(() => {
    const byRecency = recencySnapshot
      ? WorkspaceRecencyStorage.sortByRecency(workspaces)
      : workspaces
    return [...byRecency].sort((a, b) => Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)))
  }, [workspaces, pinnedIds, recencySnapshot])
}
