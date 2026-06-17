import type { QueryClient } from '@tanstack/react-query'
import { headers } from 'next/headers'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { mapChat, mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { mapWorkflow, WORKFLOW_LIST_STALE_TIME } from '@/hooks/queries/utils/workflow-list-query'

/** Forwards incoming request cookies so server-side API fetches authenticate correctly. */
async function getForwardedHeaders(): Promise<Record<string, string>> {
  const h = await headers()
  const cookie = h.get('cookie')
  return cookie ? { cookie } : {}
}

/**
 * Prefetches the workspace's workflow list under the same key and mapping as the client
 * `useWorkflows`/`useWorkflowMap` hooks, so the dehydrated data hydrates the sidebar.
 */
export function prefetchSidebarWorkflows(queryClient: QueryClient, workspaceId: string) {
  return queryClient.prefetchQuery({
    queryKey: workflowKeys.list(workspaceId, 'active'),
    queryFn: async () => {
      const fwdHeaders = await getForwardedHeaders()
      const baseUrl = getInternalApiBaseUrl()
      const response = await fetch(
        `${baseUrl}/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}&scope=active`,
        { headers: fwdHeaders }
      )
      if (!response.ok) throw new Error(`Workflows prefetch failed: ${response.status}`)
      const { data } = await response.json()
      return data.map(mapWorkflow)
    },
    staleTime: WORKFLOW_LIST_STALE_TIME,
  })
}

/**
 * Prefetches the workspace's mothership chat list under the same key and mapping as the
 * client `useMothershipChats` hook, so the dehydrated data hydrates the sidebar.
 */
export function prefetchSidebarChats(queryClient: QueryClient, workspaceId: string) {
  return queryClient.prefetchQuery({
    queryKey: mothershipChatKeys.list(workspaceId),
    queryFn: async () => {
      const fwdHeaders = await getForwardedHeaders()
      const baseUrl = getInternalApiBaseUrl()
      const response = await fetch(
        `${baseUrl}/api/mothership/chats?workspaceId=${encodeURIComponent(workspaceId)}`,
        { headers: fwdHeaders }
      )
      if (!response.ok) throw new Error(`Chats prefetch failed: ${response.status}`)
      const { data } = await response.json()
      return data.map(mapChat)
    },
    staleTime: 60 * 1000,
  })
}
