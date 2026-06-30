import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { ChangelogActions, ChangelogTimeline } from '@/app/(landing)/changelog/components'
import type { ChangelogEntry, GitHubRelease } from '@/app/(landing)/changelog/types'
import { mapReleases, releasesEndpoint } from '@/app/(landing)/changelog/utils'
import { ProseHero, ProseShell } from '@/app/(landing)/components/prose-page'

const logger = createLogger('Changelog')

/**
 * Changelog page - reuses the shared prose primitives ({@link ProseShell} +
 * {@link ProseHero}) so its headline and column match Terms and Privacy, then
 * renders the GitHub-release timeline. The first page of releases is
 * fetched here on the server at build/revalidate time; the {@link ChangelogTimeline}
 * client leaf paginates the rest. Re-authored from the prior dark changelog onto
 * the platform light tokens.
 */

const LEAD =
  'Every new feature, improvement, and fix in Sim, the open-source AI workspace, with release notes straight from GitHub.'

async function getInitialEntries(): Promise<ChangelogEntry[]> {
  try {
    // boundary-raw-fetch: external GitHub Releases API (cross-origin), not a same-origin contract
    const res = await fetch(releasesEndpoint(1), {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 3600 },
    })
    const releases = (await res.json()) as GitHubRelease[]
    return mapReleases(releases ?? [])
  } catch (error) {
    logger.warn('Failed to load initial changelog releases from GitHub', {
      error: getErrorMessage(error),
    })
    return []
  }
}

export default async function Changelog() {
  const entries = await getInitialEntries()

  return (
    <ProseShell>
      <ProseHero title='Changelog' lead={LEAD} actions={<ChangelogActions />} />
      <section id='releases' aria-label='Release history'>
        <ChangelogTimeline initialEntries={entries} />
      </section>
    </ProseShell>
  )
}
