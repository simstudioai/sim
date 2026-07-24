/**
 * Per-environment desktop update feed resolution.
 *
 * Installed desktop shells ask the Sim deployment they are pointed at —
 * `GET <origin>/api/desktop/update/latest-mac.yml` — instead of a global
 * GitHub feed, so each environment independently controls which shell build
 * its clients are offered. The environment IS the channel:
 *
 * - dev.sim.ai      → `alpha`  (per-push prerelease builds from `dev`)
 * - staging.sim.ai  → `beta`   (per-push prerelease builds from `staging`)
 * - sim.ai + self-hosted/unknown → `latest` (stable vX.Y.Z releases only)
 *
 * Artifacts stay on GitHub Releases (dumb storage); the feed route picks the
 * right release for its channel and serves that release's electron-updater
 * manifest with download URLs rewritten to absolute GitHub asset URLs.
 *
 * Channels are strictly isolated: alpha serves only `-alpha.` prereleases,
 * beta only `-beta.` prereleases, and `latest` only stable releases. Builds
 * carry per-channel app identity (Sim Dev / Sim Staging / Sim), so serving a
 * stable prod-identity artifact to a dev shell would offer an update
 * Squirrel.Mac cannot apply (bundle-id mismatch) — each channel only ever
 * moves forward on its own artifacts.
 */
import { compareVersions } from '@/lib/desktop/min-version'

export const DESKTOP_RELEASE_REPO = 'simstudioai/sim'

export type DesktopUpdateChannel = 'alpha' | 'beta' | 'latest'

/** Maps a deployment hostname to its desktop update channel. */
export function channelForHostname(hostname: string): DesktopUpdateChannel {
  const host = hostname.toLowerCase()
  if (host === 'dev.sim.ai' || host.endsWith('.dev.sim.ai')) {
    return 'alpha'
  }
  if (host === 'staging.sim.ai' || host.endsWith('.staging.sim.ai')) {
    return 'beta'
  }
  return 'latest'
}

/** The channel a specific version belongs to, from its prerelease tag. */
export function channelOfVersion(version: string): DesktopUpdateChannel {
  if (version.includes('-alpha.')) return 'alpha'
  if (version.includes('-beta.')) return 'beta'
  return 'latest'
}

/**
 * The manifest asset every desktop build uploads. electron-builder's GitHub
 * provider always names it `latest-mac.yml` regardless of the version's
 * prerelease tag (channels are a generic-provider concept); which channel a
 * release belongs to is carried entirely by its tag.
 */
export const MANIFEST_ASSET_NAME = 'latest-mac.yml'

/** The subset of the GitHub releases API the feed needs. */
export interface DesktopReleaseCandidate {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets?: Array<{ name: string; browser_download_url: string }>
}

/**
 * Picks the newest release of the channel's own kind. Channels never see
 * another channel's artifacts (see module docs). Releases without their
 * updater manifest asset are skipped — a release created before its build
 * finished (or whose build failed) must not take the channel down. Returns
 * null when nothing qualifies.
 */
export function selectReleaseForChannel(
  releases: DesktopReleaseCandidate[],
  channel: DesktopUpdateChannel
): DesktopReleaseCandidate | null {
  let best: DesktopReleaseCandidate | null = null
  let bestVersion = ''
  for (const release of releases) {
    if (release.draft) continue
    const version = release.tag_name.replace(/^v/, '')
    if (channelOfVersion(version) !== channel) continue
    // Defense in depth: a bare vX.Y.Z tag manually marked "pre-release" on
    // GitHub must not reach stable clients.
    if (channel === 'latest' && release.prerelease) continue
    if (release.assets && !release.assets.some((asset) => asset.name === MANIFEST_ASSET_NAME)) {
      continue
    }
    if (best === null) {
      const valid = compareVersions(version, '0.0.0')
      if (valid === null) continue
      best = release
      bestVersion = version
      continue
    }
    const comparison = compareVersions(version, bestVersion)
    if (comparison !== null && comparison > 0) {
      best = release
      bestVersion = version
    }
  }
  return best
}

/**
 * Rewrites the manifest's relative artifact references (`url:` entries and
 * the legacy top-level `path:`) to absolute GitHub release asset URLs, so
 * the shell downloads artifacts (and their `.blockmap`s, resolved relative
 * to the file URL) straight from GitHub while the feed itself stays served
 * by this deployment.
 */
export function rewriteManifestUrls(manifest: string, tag: string): string {
  const base = `https://github.com/${DESKTOP_RELEASE_REPO}/releases/download/${tag}/`
  return manifest.replace(/^(\s*(?:-\s*)?(?:url|path):\s*)(\S+)\s*$/gm, (line, prefix, value) => {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return line
    }
    return `${prefix}${base}${encodeURIComponent(value)}`
  })
}
