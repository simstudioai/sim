import { cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import Image from 'next/image'
import Link from 'next/link'
import { CHANGELOG_SECTION } from '@/lib/changelog/constants'
import type { ContentMeta } from '@/lib/content/schema'
import { formatPostDate } from '@/app/(landing)/components/content-utils'
import { HOME_TYPE, LANDING_STAGE_RADIUS } from '@/app/(landing)/components/landing-layout'

interface ChangelogCardProps {
  entry: ContentMeta
  featured: boolean
  priority: boolean
  basePath?: string
}

const IMAGE_SIZES =
  '(min-width: 1728px) 671px, (min-width: 1280px) calc((100vw - 80px) * 5 / 12 - 16px), (min-width: 1024px) calc((100vw - 72px) * 5 / 12 - 16px), (min-width: 768px) calc(50vw - 48px), calc(100vw - 56px)'

export function ChangelogCard({
  entry,
  featured,
  priority,
  basePath = CHANGELOG_SECTION.basePath,
}: ChangelogCardProps) {
  return (
    <Link
      id={entry.slug}
      href={`${basePath}/${entry.slug}`}
      aria-labelledby={`${entry.slug}-heading`}
      className={cn(
        'group min-w-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4',
        LANDING_STAGE_RADIUS,
        featured
          ? 'col-span-2 grid grid-cols-2 items-center gap-10 max-md:col-span-1 max-md:grid-cols-1 max-md:gap-5'
          : 'flex flex-col gap-5'
      )}
    >
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
          className='object-cover'
        />
      </div>
      <div className='flex min-w-0 flex-col items-start gap-4'>
        <time dateTime={entry.date} className='text-[var(--text-secondary)] text-sm'>
          {formatPostDate(entry.date)}
        </time>
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
    </Link>
  )
}
