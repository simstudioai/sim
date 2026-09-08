import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/** Global runtime rollout gate; OAuth requires real user sessions. */
export async function isOAuthProviderEnabled(): Promise<boolean> {
  return !isAuthDisabled && (await isFeatureEnabled('oauth-provider'))
}
