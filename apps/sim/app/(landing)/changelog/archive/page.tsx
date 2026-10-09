import { CHANGELOG_SECTION, getAllEntryMeta } from '@/lib/changelog'
import { buildCollectionPageJsonLd } from '@/lib/content/seo'
import { buildLandingMetadata } from '@/lib/landing/seo'
import {
  ChangelogHeader,
  ChangelogLayout,
  ChangelogList,
} from '@/app/(landing)/changelog/components'
import { BackLink } from '@/app/(landing)/components/back-link'
import { JsonLd } from '@/app/(landing)/components/json-ld'

export const revalidate = 3600
export const metadata = buildLandingMetadata({
  title: 'Changelog Archive | Sim',
  description: 'Browse product updates from Sim and find the full technical release history.',
  path: '/changelog/archive',
})

export default async function ChangelogArchivePage() {
  const entries = await getAllEntryMeta()
  return (
    <ChangelogLayout>
      <JsonLd
        data={buildCollectionPageJsonLd(
          { ...CHANGELOG_SECTION, name: 'Changelog Archive', basePath: '/changelog/archive' },
          entries
        )}
      />
      <ChangelogHeader
        title='All updates'
        actions={<BackLink href='/changelog' label='Back to changelog' />}
      />
      <ChangelogList entries={entries} />
      <a
        href='https://github.com/simstudioai/sim/releases'
        target='_blank'
        rel='noopener noreferrer'
        className='text-[var(--text-secondary)] text-small underline underline-offset-4'
      >
        Earlier releases and full technical history on GitHub
      </a>
    </ChangelogLayout>
  )
}
