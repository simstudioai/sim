'use client'

import { useEffect } from 'react'

export function useCredentialRefreshTriggers(
  refetchCredentials: () => Promise<unknown>,
  providerId: string,
  workspaceId: string
) {
  useEffect(() => {
    const refresh = () => {
      void refetchCredentials()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }

    const handlePageShow = (event: Event) => {
      if ('persisted' in event && (event as PageTransitionEvent).persisted) {
        refresh()
      }
    }

    const handleCredentialsUpdated = (
      event: CustomEvent<{ providerId?: string; workspaceId?: string }>
    ) => {
      if (event.detail?.providerId && event.detail.providerId !== providerId) {
        return
      }
      if (event.detail?.workspaceId && workspaceId && event.detail.workspaceId !== workspaceId) {
        return
      }
      refresh()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('oauth-credentials-updated', handleCredentialsUpdated as EventListener)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener(
        'oauth-credentials-updated',
        handleCredentialsUpdated as EventListener
      )
    }
  }, [providerId, workspaceId, refetchCredentials])
}
