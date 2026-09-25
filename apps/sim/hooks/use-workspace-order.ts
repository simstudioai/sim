'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { useInitialRecentWorkspaceIds } from '@/components/workspaces/workspace-recency-provider'
import { WorkspaceRecencyStorage } from '@/lib/core/utils/browser-storage'
import { sortByRecentIds } from '@/lib/workspaces/recency-cookie'
import type { Workspace } from '@/hooks/queries/workspace'

const serverSnapshot = () => null

/**
 * Layers the viewer's pins and visit history over the server's newest-first list.
 * Server render and hydration order by the recency cookie, which mirrors the head
 * of the localStorage history, so switching to that history after hydration does
 * not reshuffle the rows.
 */
export function useWorkspaceOrder(workspaces: Workspace[], pinnedIds: ReadonlySet<string>) {
  const initialRecentIds = useInitialRecentWorkspaceIds()
  const recencySnapshot = useSyncExternalStore(
    WorkspaceRecencyStorage.subscribe,
    WorkspaceRecencyStorage.getSnapshot,
    serverSnapshot
  )
  return useMemo(() => {
    const byRecency = recencySnapshot
      ? WorkspaceRecencyStorage.sortByRecency(workspaces)
      : sortByRecentIds(workspaces, initialRecentIds)
    return [...byRecency].sort((a, b) => Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)))
  }, [workspaces, pinnedIds, recencySnapshot, initialRecentIds])
}
