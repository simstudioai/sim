'use client'

import { useCallback } from 'react'
import { useParams } from 'next/navigation'
import { MothershipPendingContextStorage } from '@/lib/core/utils/browser-storage'
import { addMothershipContext } from '@/lib/mothership/events'
import type { ChatContext } from '@/stores/panel'

/**
 * Returns a callback that attaches a context chip to the Sim Agent (Chat) input
 * without sending — the "add to chat" side of the highlight-to-chat flow. When a
 * chat input is mounted (e.g. the Chat surface alongside the file/table viewer)
 * the chip is inserted live and the source resource opens in the slideover.
 * Otherwise the context is persisted and we navigate to the Chat, where it seeds
 * the input and opens the resource on mount — the same slideover experience as
 * opening a workflow or resource from within Chat.
 */
export function useAddToChat(): (context: ChatContext) => void {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  return useCallback(
    (context: ChatContext) => {
      const consumed = addMothershipContext(context)
      if (consumed) return
      if (!workspaceId) return
      MothershipPendingContextStorage.store(context, workspaceId)
      // Hard navigation (not router.push): a full Chat mount reliably opens the
      // resource in the slideover. A client-side transition races with useChat's
      // resource-reset effect and drops the just-opened resource.
      window.location.assign(`/workspace/${workspaceId}/home`)
    },
    [workspaceId]
  )
}
