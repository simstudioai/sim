'use client'

import { useRouter } from 'next/navigation'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import type { ChatRequestMode } from '@/lib/mothership/chat/types'
import { useOrganization } from '@/platform/lib/data/organization'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import type { ChatContext } from '@/stores/panel'

interface ChatHandoff {
  message: string
  contexts?: ChatContext[]
  requestMode?: ChatRequestMode
}

/**
 * Hands a message to a new chat in the viewer's organization: it is stored for the chat surface,
 * which sends it as it mounts, and the viewer is taken there. Available only where the viewer can
 * start a chat (`mothershipAvailable`); `handOff` does nothing otherwise.
 */
export function useChatHandoff() {
  const surface = useOrganization()
  const { organization, mothershipAvailable } = surface
  const router = useRouter()
  return {
    available: mothershipAvailable,
    handOff({ message, contexts, requestMode }: ChatHandoff) {
      if (!mothershipAvailable) return
      const stored = MothershipHandoffStorage.store(
        { message, ...(contexts ? { contexts } : {}), ...(requestMode ? { requestMode } : {}) },
        { organizationId: organization.id }
      )
      if (stored) router.push(surfaceHref(surface, '/chat'))
    },
  }
}
