'use client'

import { useEffect } from 'react'
import type { ResourceScope } from '@/lib/core/resource-scope'

export function useCredentialRefreshTriggers(
  refetchCredentials: () => Promise<unknown>,
  providerId: string,
  scope: string | ResourceScope
) {
  const workspaceId =
    typeof scope === 'string' ? scope : scope.kind === 'workspace' ? scope.workspaceId : undefined
  const organizationId =
    typeof scope !== 'string' && scope.kind === 'organization' ? scope.organizationId : undefined
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
      event: CustomEvent<{ providerId?: string; workspaceId?: string; organizationId?: string }>
    ) => {
      if (event.detail?.providerId && event.detail.providerId !== providerId) {
        return
      }
      if (
        (event.detail?.workspaceId && event.detail.workspaceId !== workspaceId) ||
        (event.detail?.organizationId && event.detail.organizationId !== organizationId)
      ) {
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
  }, [providerId, workspaceId, organizationId, refetchCredentials])
}
