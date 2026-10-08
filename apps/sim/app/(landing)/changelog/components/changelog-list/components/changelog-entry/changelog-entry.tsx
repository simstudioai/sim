import { cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import Image from 'next/image'
import Link from 'next/link'
import { CHANGELOG_SECTION } from '@/lib/changelog/constants'
import type { ContentMeta } from '@/lib/content/schema'
import { formatPostDate } from '@/app/(landing)/components/content-utils'
import { HOME_TYPE, LANDING_STAGE_RADIUS } from '@/app/(landing)/components/landing-layout'

interface ChangelogEntryProps {
  entry: ContentMeta
  priority: boolean
  basePath?: string
}

const IMAGE_SIZES =
  '(min-width: 1728px) 663px, (min-width: 1280px) calc((100vw - 80px) * 5 / 12 - 24px), (min-width: 1024px) calc((100vw - 72px) * 5 / 12 - 24px), (min-width: 768px) calc(100vw - 64px), calc(100vw - 56px)'

export function ChangelogEntry({
  entry,
  priority,
  basePath = CHANGELOG_SECTION.basePath,
}: ChangelogEntryProps) {
  return (
    <article id={entry.slug} aria-labelledby={`${entry.slug}-heading`} className='scroll-mt-28'>
      <Link
        href={`${basePath}/${entry.slug}`}
        aria-labelledby={`${entry.slug}-heading`}
        className={cn(
          'group grid min-w-0 grid-cols-2 items-center gap-12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-8 max-lg:grid-cols-1 max-lg:gap-6',
          LANDING_STAGE_RADIUS
        )}
      >
        <div className='flex min-w-0 flex-col items-start gap-4'>
          <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-[var(--text-secondary)] text-sm'>
            <time dateTime={entry.date}>{formatPostDate(entry.date)}</time>
            {entry.draft ? <span>Draft</span> : null}
          </div>
          <h3
            id={`${entry.slug}-heading`}
            className={cn('text-balance text-[var(--text-primary)]', HOME_TYPE.h3)}
          >
            {entry.title}
          </h3>
          <p className={cn('text-pretty text-[var(--text-secondary)]', HOME_TYPE.body)}>
            {entry.description}
          </p>
          <span className='inline-flex items-center gap-2 text-[var(--text-primary)] text-sm'>
            Read update
            <ArrowRight
              aria-hidden='true'
              className='size-4 text-[var(--text-icon)] transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none'
            />
          </span>
        </div>
        <div
          className={cn(
            'relative aspect-video overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]',
            LANDING_STAGE_RADIUS
          )}
        >
          <Image
            src={entry.ogImage}
            alt={entry.ogAlt ?? entry.title}
            fill
            sizes={IMAGE_SIZES}
            priority={priority}
            className='object-contain'
          />
        </div>
      </Link>
    </article>
  )
}
