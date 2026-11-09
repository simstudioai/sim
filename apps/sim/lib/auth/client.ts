import { useContext } from 'react'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { ssoClient } from '@better-auth/sso/client'
import { stripeClient } from '@better-auth/stripe/client'
import {
  adminClient,
  customSessionClient,
  emailOTPClient,
  genericOAuthClient,
  organizationClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { auth } from '@/lib/auth'
import { SessionContext, type SessionHookResult } from '@/lib/auth/session-context'
import { isBillingEnabled, isOrganizationsEnabled, isSsoEnabled } from '@/lib/core/config/env-flags'
import { getBaseUrl, getBrowserOrigin } from '@/lib/core/utils/urls'
import { useHydrated } from '@/hooks/use-hydrated'

function getAuthBaseUrl(): string {
  return getBrowserOrigin() ?? getBaseUrl()
}

export const client = createAuthClient({
  baseURL: getAuthBaseUrl(),
  plugins: [
    adminClient(),
    emailOTPClient(),
    genericOAuthClient(),
    /**
     * Types the `/oauth2/*` endpoints and forwards the signed authorize query
     * from the consent page's URL as `oauth_query` on the consent call. Inert on
     * every other page, so it does not need the deployment gate.
     */
    oauthProviderClient(),
    customSessionClient<typeof auth>(),
    ...(isBillingEnabled
      ? [
          stripeClient({
            subscription: true, // Enable subscription management
          }),
        ]
      : []),
    ...(isOrganizationsEnabled ? [organizationClient()] : []),
    ...(isSsoEnabled ? [ssoClient()] : []),
  ],
})

/**
 * The viewer's session. It reads as pending until the calling component has hydrated, even when
 * the server seeded it: views key browser storage by the viewer, which the server cannot read, so
 * a viewer revealed during hydration would paint server and client differently.
 */
export function useSession(): SessionHookResult {
  const ctx = useContext(SessionContext)
  const hydrated = useHydrated()
  if (!ctx) {
    throw new Error(
      'SessionProvider is not mounted. Wrap your app with <SessionProvider> in app/_shell/site-root-layout.tsx.'
    )
  }
  return hydrated ? ctx : { ...ctx, data: null, isPending: true }
}

export const useActiveOrganization = isOrganizationsEnabled
  ? client.useActiveOrganization
  : () => ({ data: undefined, isPending: false, error: null })

export const useSubscription = () => {
  return {
    list: client.subscription?.list,
    upgrade: client.subscription?.upgrade,
    cancel: client.subscription?.cancel,
    restore: client.subscription?.restore,
  }
}

export const { signOut } = client
