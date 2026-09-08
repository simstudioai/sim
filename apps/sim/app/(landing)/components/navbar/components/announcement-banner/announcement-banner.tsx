import { cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import Link from 'next/link'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'

const LATEST_UPDATE = {
  title: 'Tracking Secrets Through an Agent Run',
  href: '/blog/secret-provenance',
} as const

/** Slim marketing update strip shown above the primary navigation. */
export function AnnouncementBanner() {
  return (
    <aside
      aria-label='Latest update'
      data-announcement-banner
      className='h-[1.95rem] bg-[oklch(0.439_0_0)] text-[#F8F8F8] dark:bg-[var(--surface-5)] dark:text-[var(--text-primary)]'
    >
      <div
        className={cn(
          'flex h-full items-center justify-center gap-3 text-caption leading-5',
          LANDING_CONTENT_WIDTH,
          LANDING_GUTTER
        )}
      >
        <span className='ml-[19px] truncate'>{LATEST_UPDATE.title}</span>
        <Link
          href={LATEST_UPDATE.href}
          aria-label={`Read article: ${LATEST_UPDATE.title}`}
          className='group/link inline-flex shrink-0 items-center gap-1.5 font-normal text-[#B4B4B4] transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover-hover:text-[#F8F8F8] focus-visible:text-[#F8F8F8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-current focus-visible:outline-offset-2 dark:text-[var(--text-tertiary)] dark:focus-visible:text-[var(--text-primary)] dark:hover-hover:text-[var(--text-primary)]'
        >
          Read article
          <ArrowRight
            aria-hidden='true'
            className='-translate-x-1 size-[13px] shrink-0 opacity-0 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/link:translate-x-0 group-hover/link:opacity-100 group-focus-visible/link:translate-x-0 group-focus-visible/link:opacity-100 motion-reduce:translate-x-0 motion-reduce:transition-none'
          />
        </Link>
      </div>
    </aside>
  )
}
