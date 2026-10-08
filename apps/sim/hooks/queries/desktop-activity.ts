'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type DesktopChatActivity,
  listDesktopActivityContract,
} from '@/lib/api/contracts/desktop-executor'
import { desktopActivityKeys } from '@/hooks/queries/utils/desktop-activity-keys'

const DESKTOP_ACTIVITY_STALE_TIME = 10 * 1000
/**
 * Presence, approvals and new background turns change without a chat event this query hears, so
 * it is re-read on a timer: often while a desktop runs a chat, rarely otherwise. Only installs that
 * run the executor ever read it.
 */
const DESKTOP_ACTIVITY_ACTIVE_REFETCH_MS = 15 * 1000
const DESKTOP_ACTIVITY_IDLE_REFETCH_MS = 30 * 1000

async function fetchDesktopActivity(
  workspaceId: string,
  signal?: AbortSignal
): Promise<DesktopChatActivity[]> {
  const data = await requestJson(listDesktopActivityContract, { query: { workspaceId }, signal })
  return data.chats
}

/** The user's chats in this workspace whose turn runs on one of their desktops. */
export function useDesktopActivity(workspaceId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: desktopActivityKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchDesktopActivity(workspaceId as string, signal),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: DESKTOP_ACTIVITY_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.length
        ? DESKTOP_ACTIVITY_ACTIVE_REFETCH_MS
        : DESKTOP_ACTIVITY_IDLE_REFETCH_MS,
    placeholderData: keepPreviousData,
  })
}
