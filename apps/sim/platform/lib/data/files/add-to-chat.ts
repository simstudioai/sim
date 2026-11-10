'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/client'
import { organizationDraftKey } from '@/lib/organizations/draft-key'
import { useOrganization } from '@/platform/lib/data/organization'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import type { ChatContext } from '@/stores/panel'

/**
 * Attaches a selection to a new chat's draft without sending it, then opens that chat, as legacy's
 * "Add to Chat" hands a selection to the Chat input. The new-chat composer keeps its draft under
 * the `home` key of the viewer's organization (see `useLiveComposer`).
 */
export function useAddToChat(): (context: ChatContext) => void {
  const surface = useOrganization()
  const { organization } = surface
  const { data: session } = useSession()
  const router = useRouter()
  const userId = session?.user?.id
  return useCallback(
    (context: ChatContext) => {
      if (!userId) return
      const key = organizationDraftKey(userId, organization.id, 'home')
      const store = useMothershipDraftsStore.getState()
      const current = store.drafts[key] ?? { text: '' }
      store.setDraft(key, { ...current, contexts: [...(current.contexts ?? []), context] })
      router.push(surfaceHref(surface, '/chat'))
    },
    [userId, organization.id, router, surface]
  )
}
