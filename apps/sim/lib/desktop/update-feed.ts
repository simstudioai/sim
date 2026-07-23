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
 * A channel sees its own prereleases plus stable releases — never another
 * channel's prereleases (dev and staging both cut prereleases of the same
 * next core version, and semver would rank `beta` above `alpha` there). A
 * stable release published after a prerelease still moves every environment
 * forward.
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

/** The subset of the GitHub releases API the feed needs. */
export interface DesktopReleaseCandidate {
  tag_name: string
  draft: boolean
  prerelease: boolean
}

/**
 * Picks the newest release a channel may see: stable releases plus the
 * channel's own prereleases. Ordering is semver, so a stable release
 * supersedes earlier prereleases of the same core version. Returns null when
 * nothing qualifies.
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
    const releaseChannel = channelOfVersion(version)
    if (releaseChannel !== 'latest' && releaseChannel !== channel) continue
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

/** The electron-updater manifest asset name a release's build produced. */
export function manifestAssetName(version: string): string {
  const channel = channelOfVersion(version)
  return channel === 'latest' ? 'latest-mac.yml' : `${channel}-mac.yml`
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
