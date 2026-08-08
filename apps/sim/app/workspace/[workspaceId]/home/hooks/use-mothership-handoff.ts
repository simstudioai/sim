'use client'

import { useEffect, useRef } from 'react'
import { useQueryState } from 'nuqs'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import type { UseChatReturn } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import {
  mothershipHandoffParam,
  mothershipHandoffUrlKeys,
} from '@/app/workspace/[workspaceId]/home/search-params'

interface UseMothershipHandoffProps {
  chatId?: string
  workspaceId: string
  sendMessage: UseChatReturn['sendMessage']
}

/** Consumes fresh-chat handoffs on first mount and cached-route reactivation. */
export function useMothershipHandoff({
  chatId,
  workspaceId,
  sendMessage,
}: UseMothershipHandoffProps): void {
  const [handoffSignal, setHandoffSignal] = useQueryState(mothershipHandoffParam.key, {
    ...mothershipHandoffParam.parser,
    ...mothershipHandoffUrlKeys,
  })
  const hasCheckedInitialHandoffRef = useRef(false)

  useEffect(() => {
    const shouldCheck = !hasCheckedInitialHandoffRef.current || Boolean(handoffSignal)
    if (!shouldCheck) return

    hasCheckedInitialHandoffRef.current = true
    if (handoffSignal) void setHandoffSignal(null)
    if (chatId) return

    const handoff = MothershipHandoffStorage.consume(workspaceId)
    if (handoff) void sendMessage(handoff.message, undefined, handoff.contexts)
  }, [chatId, handoffSignal, sendMessage, setHandoffSignal, workspaceId])
}
