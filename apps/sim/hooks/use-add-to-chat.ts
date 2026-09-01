'use client'

import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { addMothershipContexts } from '@/lib/mothership/events'
import type { ChatContext } from '@/stores/panel'

/**
 * Returns a callback that attaches a context chip to the Sim Agent (Chat) input
 * without sending — the "add to chat" side of the highlight-to-chat flow. When a
 * chat input is mounted (e.g. the Chat surface alongside the file/table viewer)
 * the chip is inserted live and the source resource opens in the slideover.
 * Otherwise the context is persisted as a chip-only handoff and we navigate to
 * Chat, where it seeds the input and opens the resource on mount.
 *
 * Navigation is gated on a successful store, so a failed write never strands the
 * user on an empty chat.
 */
export function useAddToChat(): (context: ChatContext) => void {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()

  return useCallback(
    (context: ChatContext) => {
      if (addMothershipContexts([context])) return
      if (!workspaceId) return
      if (MothershipHandoffStorage.store({ contexts: [context] }, workspaceId)) {
        router.push(`/workspace/${workspaceId}/home`)
      }
    },
    [workspaceId, router]
  )
}
