/**
 * Build-time channel identity, derived from the origin a build is baked to.
 *
 * Must stay in sync with APP_NAME_FOR_CHANNEL / channelForOrigin in
 * src/main/config.ts. That pair is the RUNTIME source of truth — the app calls
 * app.setName() from its baked origin at startup, which decides the userData
 * directory and single-instance lock — and this is what the packager stamps
 * into the bundle. When the two disagree, the bundle on disk and the running
 * app disagree about which app they are: a dev-pointed build packaged as
 * "Sim.app" with the production bundle id installs over a real production
 * install while naming itself "Sim Dev" at runtime.
 */

/** Canonical no-redirect origins per environment. */
export const PROD_ORIGIN = 'https://www.sim.ai'
export const STAGING_ORIGIN = 'https://www.staging.sim.ai'
export const DEV_ORIGIN = 'https://www.dev.sim.ai'
export const LOCAL_ORIGIN = 'http://localhost:3000'

export interface ChannelIdentity {
  /** Display + bundle name; also the userData directory name. */
  name: string
  appId: string
  /** Baked default origin + persisted settings origin. */
  origin: string
  /**
   * Artifact filename stem, and the per-channel scratch directory name.
   * Space-free for the same reason electron-builder.yml's artifactName is:
   * GitHub rewrites asset names containing spaces, which desyncs the
   * electron-updater manifest from the uploaded files.
   */
  slug: string
}

export const PROD: ChannelIdentity = {
  name: 'Sim',
  appId: 'ai.sim.desktop',
  origin: PROD_ORIGIN,
  slug: 'sim',
}
export const STAGING: ChannelIdentity = {
  name: 'Sim Staging',
  appId: 'ai.sim.desktop.staging',
  origin: STAGING_ORIGIN,
  slug: 'sim-staging',
}
export const DEV: ChannelIdentity = {
  name: 'Sim Dev',
  appId: 'ai.sim.desktop.dev',
  origin: DEV_ORIGIN,
  slug: 'sim-dev',
}
export const LOCAL: ChannelIdentity = {
  name: 'Sim Local',
  appId: 'ai.sim.desktop.local',
  origin: LOCAL_ORIGIN,
  slug: 'sim-local',
}

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
