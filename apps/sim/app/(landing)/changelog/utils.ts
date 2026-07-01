import type { ChangelogEntry, GitHubRelease } from '@/app/(landing)/changelog/types'

/**
 * Changelog helpers shared by the server page (initial page) and the client
 * timeline (subsequent pages), so the GitHub-release → entry mapping is defined
 * once and both surfaces stay in sync.
 */

/** How many releases to request per GitHub API page. */
export const RELEASES_PER_PAGE = 10

/** Builds the GitHub Releases endpoint for a given 1-based page. */
export function releasesEndpoint(page: number): string {
  return `https://api.github.com/repos/simstudioai/sim/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`
}

/** Removes literal `&nbsp` artifacts from release bodies. */
export function sanitizeContent(body: string): string {
  return body.replace(/&nbsp/g, '')
}

/** Extracts unique `@handle` GitHub mentions from a release body. */
export function extractMentions(body: string): string[] {
  const matches = body.match(/@([A-Za-z0-9-]+)/g) ?? []
  return Array.from(new Set(matches.map((mention) => mention.slice(1))))
}

/** Maps non-prerelease GitHub releases to normalized {@link ChangelogEntry} items. */
export function mapReleases(releases: GitHubRelease[]): ChangelogEntry[] {
  return releases
    .filter((release) => !release.prerelease)
    .map((release) => {
      const body = String(release.body ?? '')
      return {
        tag: release.tag_name,
        title: release.name || release.tag_name,
        content: sanitizeContent(body),
        date: release.published_at,
        url: release.html_url,
        contributors: extractMentions(body),
      }
    })
}
