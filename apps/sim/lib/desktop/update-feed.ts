/**
 * Per-environment desktop update feed resolution.
 *
 * Installed desktop shells ask the Sim deployment they are pointed at —
 * `GET <origin>/api/desktop/update/latest-mac.yml` — instead of a global
 * GitHub feed, so each environment independently controls which shell build
 * its clients are offered. The environment IS the channel:
 *
 * - hosted `dev` deployment     → `dev`     (per-push prerelease builds from `dev`)
 * - hosted `staging` deployment → `staging` (per-push prerelease builds from `staging`)
 * - production + self-hosted    → `latest`  (stable vX.Y.Z releases only)
 *
 * Artifacts stay on GitHub Releases (dumb storage). Stable releases live in
 * the source repository; dev and staging releases live in a release-only
 * repository so source-repository followers are not notified for every shell
 * build. The feed route picks both the repository and release for its channel,
 * then serves that release's electron-updater manifest with download URLs
 * rewritten to absolute GitHub asset URLs.
 *
 * Streams are strictly isolated: dev serves `-dev.` prereleases, staging
 * `-staging.`, and `latest` only stable releases. The legacy `-alpha.` and
 * `-beta.` tags remain readable so already-published builds keep updating. Builds
 * carry per-channel app identity (Sim Dev / Sim Staging / Sim), so serving a
 * stable prod-identity artifact to a dev shell would offer an update
 * Squirrel.Mac cannot apply (bundle-id mismatch) — each channel only ever
 * moves forward on its own artifacts.
 */
import { compareVersions } from '@/lib/desktop/min-version'

export const DESKTOP_STABLE_RELEASE_REPOSITORY = 'simstudioai/sim'
export const DESKTOP_PRERELEASE_REPOSITORY = 'simstudioai/sim-desktop-releases'

export type DesktopReleaseRepository =
  | typeof DESKTOP_STABLE_RELEASE_REPOSITORY
  | typeof DESKTOP_PRERELEASE_REPOSITORY

export type DesktopUpdateChannel = 'dev' | 'staging' | 'latest'

/** Maps Sim's server-controlled deployment environment to its update channel. */
export function channelForDeploymentEnvironment(
  environment: string | undefined
): DesktopUpdateChannel {
  if (environment === 'dev') return 'dev'
  if (environment === 'staging') return 'staging'
  return 'latest'
}

/** Keeps stable and prerelease release storage isolated by channel. */
export function releaseRepositoryForChannel(
  channel: DesktopUpdateChannel
): DesktopReleaseRepository {
  return channel === 'latest' ? DESKTOP_STABLE_RELEASE_REPOSITORY : DESKTOP_PRERELEASE_REPOSITORY
}

/** The channel a specific version belongs to, from its prerelease tag. */
export function channelOfVersion(version: string): DesktopUpdateChannel {
  if (version.includes('-dev.') || version.includes('-alpha.')) return 'dev'
  if (version.includes('-staging.') || version.includes('-beta.')) return 'staging'
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
export function rewriteManifestUrls(
  manifest: string,
  tag: string,
  repository: DesktopReleaseRepository
): string {
  const base = `https://github.com/${repository}/releases/download/${tag}/`
  return manifest.replace(/^(\s*(?:-\s*)?(?:url|path):\s*)(\S+)\s*$/gm, (line, prefix, value) => {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return line
    }
    return `${prefix}${base}${encodeURIComponent(value)}`
  })
}

/**
 * GitHub's maximum page size for the releases API. The stable channel reads a
 * release list it shares with web-app releases, SDK releases, and legacy
 * prereleases, so the window has to be wide enough that desktop releases are
 * never pushed out of it.
 */
export const DESKTOP_RELEASES_PAGE_SIZE = 100

/**
 * How far back the resolver walks before giving up. A channel whose newest
 * release is buried deeper than this is already unreachable to its clients,
 * and an unbounded walk would let an unrelated tag family stall the feed.
 */
export const MAX_DESKTOP_RELEASE_PAGES = 5

/** One page of the GitHub releases API, newest release first. */
export function releasesApiUrl(repository: DesktopReleaseRepository, page: number): string {
  return `https://api.github.com/repos/${repository}/releases?per_page=${DESKTOP_RELEASES_PAGE_SIZE}&page=${page}`
}

/**
 * The newest release of a channel, walking pages until one yields a match.
 *
 * GitHub returns releases newest-first, so the first page containing any
 * release of the channel also contains its newest one — every later page is
 * strictly older. The walk exists only so unrelated releases stacked on top
 * (other tag families, other channels) cannot push a channel's newest build
 * out of the window and take the whole channel's updates down.
 *
 * `fetchPage` returns null when the page could not be read; the resolver
 * surfaces that as a failure rather than silently serving an older release.
 */
export async function resolveLatestRelease(
  channel: DesktopUpdateChannel,
  fetchPage: (page: number) => Promise<DesktopReleaseCandidate[] | null>
): Promise<{ release: DesktopReleaseCandidate | null } | { error: 'fetch-failed' }> {
  for (let page = 1; page <= MAX_DESKTOP_RELEASE_PAGES; page++) {
    const releases = await fetchPage(page)
    if (releases === null) return { error: 'fetch-failed' }
    const release = selectReleaseForChannel(releases, channel)
    if (release) return { release }
    // A short page is the end of the list; nothing older remains to walk.
    if (releases.length < DESKTOP_RELEASES_PAGE_SIZE) break
  }
  return { release: null }
}

/**
 * The human-installable artifact of a release, preferred over the zip the
 * updater consumes. Selected per-release rather than through GitHub's
 * repository-wide "latest release", which the stable repository shares with
 * web-app and SDK tags that carry no desktop artifact at all.
 */
export function selectInstallerAsset(
  release: DesktopReleaseCandidate
): { name: string; browser_download_url: string } | null {
  const assets = release.assets ?? []
  return (
    assets.find((asset) => asset.name.endsWith('.dmg')) ??
    assets.find((asset) => asset.name.endsWith('.zip')) ??
    null
  )
}
