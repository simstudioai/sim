import { createLogger } from '@sim/logger'
import { useMutation } from '@tanstack/react-query'
import type { ConnectedAccount } from '@/lib/api/contracts/oauth-connections'
import { client } from '@/lib/auth/client'
import { OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM } from '@/lib/credentials/draft-constants'
import { getDesktopBridge } from '@/lib/desktop'
import { getPerRequestOAuthLinkScopes } from '@/lib/oauth/utils'

const logger = createLogger('OAuthConnectionsQuery')

interface ConnectServiceParams {
  providerId: string
  callbackURL: string
  draftId?: string
}

/**
 * Initiates OAuth connection flow for a service.
 * Redirects the user to the provider's authorization page.
 */
export function useConnectOAuthService() {
  return useMutation({
    mutationFn: async ({ providerId, callbackURL, draftId }: ConnectServiceParams) => {
      /**
       * Desktop keeps the entire provider flow in the system browser so the
       * authorization route's state cookies and callback use one cookie jar.
       */
      const desktopBridge = getDesktopBridge()
      if (desktopBridge?.beginOAuthConnect) {
        const opened = await desktopBridge.beginOAuthConnect(
          providerId,
          draftId ? { draftId } : undefined
        )
        if (!opened) {
          throw new Error('Could not open your browser to connect this account.')
        }
        return { success: true }
      }

      if (providerId === 'trello') {
        const returnUrl = encodeURIComponent(callbackURL)
        const draftQuery = draftId ? `&draftId=${encodeURIComponent(draftId)}` : ''
        window.location.href = `/api/auth/trello/authorize?returnUrl=${returnUrl}${draftQuery}`
        return { success: true }
      }

      if (providerId === 'instagram') {
        const returnUrl = encodeURIComponent(callbackURL)
        const draftQuery = draftId ? `&draftId=${encodeURIComponent(draftId)}` : ''
        window.location.href = `/api/auth/instagram/authorize?returnUrl=${returnUrl}${draftQuery}`
        return { success: true }
      }

      if (providerId === 'shopify') {
        const returnUrl = encodeURIComponent(callbackURL)
        const draftQuery = draftId ? `&draftId=${encodeURIComponent(draftId)}` : ''
        window.location.href = `/api/auth/shopify/authorize?returnUrl=${returnUrl}${draftQuery}`
        return { success: true }
      }

      if (providerId === 'quickbooks') {
        if (!draftId) {
          throw new Error('QuickBooks authorization requires a credential connection draft.')
        }
        const authorizeUrl = new URL('/api/auth/oauth2/authorize', window.location.origin)
        authorizeUrl.searchParams.set('draftId', draftId)
        authorizeUrl.searchParams.set('callbackURL', callbackURL)
        window.location.href = authorizeUrl.toString()
        return { success: true }
      }

      const stateCallbackUrl = new URL(callbackURL)
      if (draftId) {
        stateCallbackUrl.searchParams.set(OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM, draftId)
      }

      const scopes = getPerRequestOAuthLinkScopes(providerId)
      // Better Auth answers a refused link (an untrusted origin, a disabled provider) with `error`
      // rather than throwing; without this the caller resolved and its modal closed silently.
      const { error } = await client.oauth2.link({
        providerId,
        callbackURL: stateCallbackUrl.toString(),
        ...(scopes && { scopes }),
      })
      if (error) throw new Error(error.message || 'Could not start connecting this account.')

      return { success: true }
    },
    onError: (error) => {
      logger.error('OAuth connection error:', error)
    },
  })
}

/** Connected OAuth account for a specific provider. */
export type { ConnectedAccount }
