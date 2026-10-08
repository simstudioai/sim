import { cn } from '@sim/emcn'
import type { ContentPost } from '@/lib/content/schema'
import { BackLink } from '@/app/(landing)/components/back-link'
import { formatPostDate } from '@/app/(landing)/components/content-utils'
import { HOME_TYPE, LANDING_TYPE } from '@/app/(landing)/components/landing-layout'

interface ChangelogArticleProps {
  entry: ContentPost
  backHref?: string
  archiveHref?: string
}

/** A focused reading column contains the update's product recordings and release details. */
export function ChangelogArticle({
  entry,
  backHref = '/changelog',
  archiveHref = '/changelog/archive',
}: ChangelogArticleProps) {
  const updated =
    entry.updated && entry.updated.slice(0, 10) !== entry.date.slice(0, 10)
      ? entry.updated
      : undefined
  return (
    <article
      id={entry.slug}
      className='mx-auto w-full max-w-[900px]'
      itemScope
      itemType='https://schema.org/BlogPosting'
    >
      <header className='flex flex-col items-start gap-6'>
        <BackLink href={backHref} label='Back to changelog' />
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-[var(--text-secondary)] text-sm'>
          {entry.draft ? <span>Draft</span> : null}
          <time dateTime={entry.date}>{formatPostDate(entry.date)}</time>
          {entry.release ? <span>{entry.release.versions.join(' · ')}</span> : null}
          {updated ? <time dateTime={entry.updated}>Updated {formatPostDate(updated)}</time> : null}
        </div>
        <h1
          itemProp='headline'
          className={cn('text-balance text-[var(--text-primary)]', LANDING_TYPE.proof)}
        >
          {entry.title}
        </h1>
      </header>
      <section id='update-details' aria-labelledby='update-details-heading' className='mt-8'>
        <h2 id='update-details-heading' className='sr-only'>
          In this update
        </h2>
        <entry.Content />
      </section>
      <footer
        className={cn('mt-10 flex flex-wrap gap-6 text-[var(--text-secondary)]', HOME_TYPE.meta)}
      >
        {entry.release?.url ? (
          <a
            href={entry.release.url}
            target='_blank'
            rel='noopener noreferrer'
            className='underline underline-offset-4'
          >
            Technical release notes
          </a>
        ) : null}
        <BackLink href={archiveHref} label='All updates' />
      </footer>
    </article>
  )
}
