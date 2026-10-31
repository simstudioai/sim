import type { SessionPrincipal } from '@sim/auth/principal'
import { defineOperation } from '@/lib/core/application'
import { RateLimiter, type TokenBucketConfig } from '@/lib/core/rate-limiter'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import { cachedFavicon, type FaviconResolution, resolveFavicon } from '@/lib/favicon/resolve.server'

const rateLimiter = new RateLimiter()

/**
 * Lookups that may reach the icon providers, per user; an icon already cached is served without
 * charge. Each lookup can ask the providers about several hosts, and caches what it finds for days.
 */
const PROVIDER_LOOKUP_LIMIT: TokenBucketConfig = {
  maxTokens: 120,
  refillRate: 60,
  refillIntervalMs: 60_000,
}

/** A site's icon for the signed-in user, or why there is none to serve. */
export const getFavicon = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: A public site's icon reveals nothing the caller's permissions govern.
  operation: defineOperation({
    id: 'favicons.get',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: { host: string }
  }): Promise<FaviconResolution> {
    const cached = await cachedFavicon(input.host)
    if (cached) return cached
    const { allowed } = await rateLimiter.checkRateLimitDirect(
      `route:favicon-lookup:user:${principal.userId}`,
      PROVIDER_LOOKUP_LIMIT
    )
    return allowed ? resolveFavicon(input.host) : { kind: 'unavailable' }
  },
})
