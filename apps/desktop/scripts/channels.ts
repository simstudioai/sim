/**
 * Build-time channel identity, derived from the origin a build is baked to. The identity itself
 * is `CHANNEL_IDENTITIES` (src/shared/channel-identity.ts), which the running app claims too.
 *
 * {@link identityForOrigin} must stay in sync with channelForOrigin in src/main/config.ts: when
 * the two disagree, a dev-pointed build packaged as "Sim.app" with the production bundle id
 * installs over a real production install while naming itself "Sim Dev" at runtime.
 */
import { CHANNEL_IDENTITIES, type DesktopChannelIdentity } from '@/shared/channel-identity'

/** Canonical no-redirect origins per environment. */
export const PROD_ORIGIN = 'https://www.sim.ai'
export const STAGING_ORIGIN = 'https://www.staging.sim.ai'
export const DEV_ORIGIN = 'https://www.dev.sim.ai'
export const LOCAL_ORIGIN = 'http://localhost:3000'

/** A channel's identity, with the origin its builds are baked to. */
export interface ChannelIdentity extends DesktopChannelIdentity {
  /** Baked default origin + persisted settings origin. */
  origin: string
}

export const PROD: ChannelIdentity = { ...CHANNEL_IDENTITIES.prod, origin: PROD_ORIGIN }
export const STAGING: ChannelIdentity = { ...CHANNEL_IDENTITIES.staging, origin: STAGING_ORIGIN }
export const DEV: ChannelIdentity = { ...CHANNEL_IDENTITIES.dev, origin: DEV_ORIGIN }
export const LOCAL: ChannelIdentity = { ...CHANNEL_IDENTITIES.local, origin: LOCAL_ORIGIN }

/** Every channel, in the order a full run builds them. */
export const ALL_CHANNELS: readonly ChannelIdentity[] = [PROD, STAGING, DEV, LOCAL]

/**
 * Resolves the identity a build baked to `origin` must carry. Mirrors
 * channelForOrigin in src/main/config.ts, including its fall-through to
 * production for unrecognized hosts (self-hosted origins are production
 * builds pointed elsewhere). An empty origin means "unset", which the app
 * resolves to DEFAULT_ORIGIN — production.
 */
export function identityForOrigin(origin: string): ChannelIdentity {
  if (!origin) return PROD
  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    return PROD
  }
  if (host === 'localhost' || host === '127.0.0.1') return LOCAL
  if (host === 'dev.sim.ai' || host.endsWith('.dev.sim.ai')) return DEV
  if (host === 'staging.sim.ai' || host.endsWith('.staging.sim.ai')) return STAGING
  return PROD
}
