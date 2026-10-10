import { cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import Link from 'next/link'
import { CHANGELOG_SECTION } from '@/lib/changelog/constants'
import type { ContentMeta } from '@/lib/content/schema'
import { formatPostDate } from '@/app/(landing)/components/content-utils'
import { HOME_TYPE } from '@/app/(landing)/components/landing-layout'

interface ChangelogEntryProps {
  entry: ContentMeta
  basePath?: string
}

export function ChangelogEntry({
  entry,
  basePath = CHANGELOG_SECTION.basePath,
}: ChangelogEntryProps) {
  return (
    <article id={entry.slug} aria-labelledby={`${entry.slug}-heading`} className='scroll-mt-28'>
      <Link
        href={`${basePath}/${entry.slug}`}
        aria-labelledby={`${entry.slug}-heading`}
        className='group grid min-w-0 grid-cols-[136px_1fr_auto] items-baseline gap-8 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-8 max-sm:grid-cols-[1fr_auto] max-sm:gap-x-4 max-sm:gap-y-3'
      >
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-[var(--text-secondary)] text-sm max-sm:col-span-2'>
          <time dateTime={entry.date}>{formatPostDate(entry.date)}</time>
          {entry.draft ? <span>Draft</span> : null}
        </div>
        <h3
          id={`${entry.slug}-heading`}
          className={cn('min-w-0 text-pretty text-[var(--text-primary)]', HOME_TYPE.h3)}
        >
          {entry.title}
        </h3>
        <ArrowRight
          aria-hidden='true'
          className='size-4 shrink-0 text-[var(--text-icon)] transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none'
        />
      </Link>
    </article>
  )
}
