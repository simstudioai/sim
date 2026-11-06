'use client'

import { useEffect } from 'react'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { createSearchResource } from '@/lib/mothership/resources/search'
import {
  chatSendOptions,
  type useOrganizationConversation,
} from '@/app/_organization-conversation/use-organization-conversation'
import { searchFiltersFromParams } from '@/app/workspace/[workspaceId]/home/search-params'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'

interface UsePageConversationEffectsOptions {
  chatId?: string
  requestMode: ChatRequestMode
  conversation: ReturnType<typeof useOrganizationConversation>
}

/** What only a page does on arrival: reopening a results tab and taking a handed-off first message. */
export function usePageConversationEffects({
  chatId,
  requestMode,
  conversation,
}: UsePageConversationEffectsOptions) {
  const { organization, chat, controller, panel, hasChat, searchParams } = conversation
  const { q, source, updated, from, to } = searchParams
  const addResource = panel.addResourceFromUser
  const { sendMessage } = chat
  /** Restore an explicitly selected results tab before the first turn; closing it clears the URL. */
  useEffect(() => {
    if (hasChat || !q.trim()) return
    const resource = createSearchResource({
      scope: { kind: 'organization', organizationId: organization.id },
      query: q.trim(),
      filters: searchFiltersFromParams({ source, updated, from, to }, Date.now()),
    })
    if (
      controller.activeResourceParam !== resource.id ||
      chat.resources.some((entry) => entry.id === resource.id)
    )
      return
    addResource(resource)
  }, [
    hasChat,
    q,
    source,
    updated,
    from,
    to,
    organization.id,
    controller.activeResourceParam,
    chat.resources,
    addResource,
  ])

  useEffect(() => {
    if (chatId) return
    const handoff = MothershipHandoffStorage.consume(
      { organizationId: organization.id },
      undefined,
      requestMode
    )
    if (handoff && (handoff.message || handoff.fileAttachments?.length)) {
      void sendMessage(handoff.message ?? '', handoff.fileAttachments, handoff.contexts, {
        ...chatSendOptions(requestMode, handoff.assistantSearch),
        ...(handoff.resumeUserMessageId
          ? { resumeUserMessageId: handoff.resumeUserMessageId }
          : {}),
      })
    }
  }, [chatId, organization.id, requestMode, sendMessage])
}
