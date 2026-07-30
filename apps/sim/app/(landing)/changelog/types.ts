/**
 * Changelog types shared between the server page (initial fetch) and the client
 * timeline (load-more). {@link GitHubRelease} is the minimal shape we read from
 * the GitHub Releases API; {@link ChangelogEntry} is the normalized entry the UI
 * renders.
 */

/** The minimal subset of a GitHub Releases API item that the changelog reads. */
export interface GitHubRelease {
  tag_name: string
  name: string | null
  body: string | null
  published_at: string
  html_url: string
  prerelease: boolean
}

/** A normalized changelog entry rendered in the timeline. */
export interface ChangelogEntry {
  tag: string
  title: string
  content: string
  date: string
  url: string
  contributors: string[]
}
