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

import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
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
export const MAX_DESKTOP_UPDATE_MANIFEST_BYTES = 256 * 1024

/** The subset of the GitHub releases API the feed needs. */
export interface DesktopReleaseCandidate {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets?: Array<{ name: string; browser_download_url: string }>
}

/**
 * Lists releases of the channel's own kind, newest first. Channels never see
 * another channel's artifacts (see module docs). Releases without their
 * updater manifest asset are skipped — a release created before its build
 * finished (or whose build failed) must not take the channel down.
 */
function releasesForChannel(
  releases: DesktopReleaseCandidate[],
  channel: DesktopUpdateChannel
): DesktopReleaseCandidate[] {
  const candidates: Array<{ release: DesktopReleaseCandidate; version: string }> = []
  for (const release of releases) {
    if (release.draft) continue
    const version = release.tag_name.replace(/^v/, '')
    if (channelOfVersion(version) !== channel) continue
    // Defense in depth: a bare vX.Y.Z tag manually marked "pre-release" on
    // GitHub must not reach stable clients.
    if (channel === 'latest' && release.prerelease) continue
    if (!release.assets?.some((asset) => asset.name === MANIFEST_ASSET_NAME)) {
      continue
    }
    if (compareVersions(version, '0.0.0') === null) continue
    candidates.push({ release, version })
  }
  candidates.sort((left, right) => compareVersions(right.version, left.version) ?? 0)
  return candidates.map(({ release }) => release)
}

/** Picks the newest release that passes the channel and manifest-presence checks. */
export function selectReleaseForChannel(
  releases: DesktopReleaseCandidate[],
  channel: DesktopUpdateChannel
): DesktopReleaseCandidate | null {
  return releasesForChannel(releases, channel)[0] ?? null
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
  repository: DesktopReleaseRepository,
  availableAssetNames: ReadonlySet<string>
): string | null {
  const base = `https://github.com/${repository}/releases/download/${tag}/`
  const version = tag.replace(/^v/, '')
  const expectedNames = new Set([`Sim-${version}-universal.dmg`, `Sim-${version}-universal.zip`])
  let valid = true
  let hasUpdaterFile = false
  const rewritten = manifest.replace(
    /^(\s*(?:-\s*)?(?:url|path):\s*)(\S+)\s*$/gm,
    (_line, prefix: string, value: string) => {
      try {
        const pathname =
          value.startsWith('http://') || value.startsWith('https://')
            ? new URL(value).pathname
            : value
        const name = decodeURIComponent(pathname.split('/').at(-1) ?? '')
        if (!expectedNames.has(name) || !availableAssetNames.has(name)) {
          valid = false
          return ''
        }
        if (/\burl:\s*$/.test(prefix)) hasUpdaterFile = true
        return `${prefix}${base}${encodeURIComponent(name)}`
      } catch {
        valid = false
        return ''
      }
    }
  )
  return valid && hasUpdaterFile ? rewritten : null
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

export interface DesktopReleaseAssets {
  manifest: string
  installer: { name: string; browser_download_url: string }
}

/** Reads and validates the complete artifact set required to offer a release. */
export async function resolveReleaseAssets(
  release: DesktopReleaseCandidate,
  repository: DesktopReleaseRepository,
  fetchManifest: (url: string) => Promise<Response>
): Promise<DesktopReleaseAssets | null> {
  const manifestAsset = release.assets?.find((asset) => asset.name === MANIFEST_ASSET_NAME)
  const installer = selectInstallerAsset(release, repository)
  if (!manifestAsset || !installer) return null

  try {
    const response = await fetchManifest(manifestAsset.browser_download_url)
    if (!response.ok) return null
    const source = await readResponseTextWithLimit(response, {
      maxBytes: MAX_DESKTOP_UPDATE_MANIFEST_BYTES,
      label: 'Desktop update manifest',
    })
    const version = release.tag_name.replace(/^v/, '')
    if (/^version:\s*(\S+)\s*$/m.exec(source)?.[1] !== version) return null

    const availableAssetNames = new Set(release.assets?.map((asset) => asset.name))
    const manifest = rewriteManifestUrls(source, release.tag_name, repository, availableAssetNames)
    return manifest ? { manifest, installer } : null
  } catch {
    return null
  }
}

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
 * Every candidate is passed to `resolveCandidate`; a rejected candidate falls
 * through to the next version. `fetchPage` returning null remains fatal because
 * an unreadable page could hide a newer valid release.
 */
export async function resolveLatestRelease<T>(
  channel: DesktopUpdateChannel,
  fetchPage: (page: number) => Promise<DesktopReleaseCandidate[] | null>,
  resolveCandidate: (release: DesktopReleaseCandidate) => T | null | Promise<T | null>
): Promise<
  | { release: DesktopReleaseCandidate; value: T }
  | { release: null; rejectedCandidates: boolean }
  | { error: 'fetch-failed' }
> {
  let rejectedCandidates = false
  for (let page = 1; page <= MAX_DESKTOP_RELEASE_PAGES; page++) {
    const releases = await fetchPage(page)
    if (releases === null) return { error: 'fetch-failed' }
    for (const release of releasesForChannel(releases, channel)) {
      const value = await resolveCandidate(release)
      if (value !== null) return { release, value }
      rejectedCandidates = true
    }
    // A short page is the end of the list; nothing older remains to walk.
    if (releases.length < DESKTOP_RELEASES_PAGE_SIZE) break
  }
  return { release: null, rejectedCandidates }
}

/**
 * The human-installable artifact of a release, preferred over the zip the
 * updater consumes. Selected per-release rather than through GitHub's
 * repository-wide "latest release", which the stable repository shares with
 * web-app and SDK tags that carry no desktop artifact at all.
 */
export function selectInstallerAsset(
  release: DesktopReleaseCandidate,
  repository: DesktopReleaseRepository
): { name: string; browser_download_url: string } | null {
  const assets = release.assets ?? []
  const version = release.tag_name.replace(/^v/, '')
  const dmgName = `Sim-${version}-universal.dmg`
  const zipName = `Sim-${version}-universal.zip`
  const asset =
    assets.find((candidate) => candidate.name === dmgName) ??
    assets.find((candidate) => candidate.name === zipName)
  if (!asset) return null
  return {
    name: asset.name,
    browser_download_url: `https://github.com/${repository}/releases/download/${release.tag_name}/${asset.name}`,
  }
}
