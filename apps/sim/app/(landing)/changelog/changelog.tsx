import Link from 'next/link'
import { CHANGELOG_SECTION, getAllEntryMeta, LATEST_ENTRY_LIMIT } from '@/lib/changelog'
import { buildCollectionPageJsonLd } from '@/lib/content/seo'
import {
  ChangelogActions,
  ChangelogGrid,
  ChangelogHeader,
  ChangelogLayout,
} from '@/app/(landing)/changelog/components'
import { JsonLd } from '@/app/(landing)/components/json-ld'

export default async function Changelog() {
  const metadata = await getAllEntryMeta()
  const visible = metadata.slice(0, LATEST_ENTRY_LIMIT)
  return (
    <ChangelogLayout>
      <JsonLd data={buildCollectionPageJsonLd(CHANGELOG_SECTION, visible)} />
      <ChangelogHeader
        title='Changelog'
        lead={CHANGELOG_SECTION.description}
        actions={<ChangelogActions />}
      />
      <ChangelogGrid entries={visible} featureLatest />
      <div className='flex flex-wrap gap-6 border-[var(--border)] border-t pt-6 text-[var(--text-secondary)] text-sm'>
        <Link href='/changelog/archive' className='underline underline-offset-4'>
          All updates
        </Link>
        <a
          href='https://github.com/simstudioai/sim/releases'
          target='_blank'
          rel='noopener noreferrer'
          className='underline underline-offset-4'
        >
          Earlier releases on GitHub
        </a>
      </div>
    </ChangelogLayout>
  )
}
