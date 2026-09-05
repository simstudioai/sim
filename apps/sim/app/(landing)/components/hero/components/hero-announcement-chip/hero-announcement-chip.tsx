'use client'

import { ChipLink, ChipTag, cn } from '@sim/emcn'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'
import { SIGNUP_HREF } from '@/app/(landing)/constants'

interface AnnouncementArrowProps {
  className?: string
}

function AnnouncementArrow({ className }: AnnouncementArrowProps) {
  return <ChevronArrow className={cn(className, 'size-3')} strokeWidth={1} />
}

/** Rounded announcement with a compact status badge and a single linked action. */
export function HeroAnnouncementChip() {
  return (
    <ChipLink
      variant='outline'
      href={SIGNUP_HREF}
      prefetch={false}
      rightIcon={AnnouncementArrow}
      leftAdornment={
        <ChipTag
          variant='gray'
          className='h-4 shrink-0 rounded-full bg-transparent px-1.5 font-medium text-[10px] uppercase leading-none tracking-[0.06em]'
        >
          New
        </ChipTag>
      }
      className={cn(
        'group/link h-8 max-w-full gap-2 rounded-full bg-[var(--surface-2)] pr-3 pl-2 text-[13px] duration-150 [&>span.flex-1]:[font-size:inherit]',
        'hover-hover:bg-[var(--surface-3)]',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4'
      )}
    >
      <span className='inline-flex min-w-0 items-center gap-1'>
        <span className='truncate font-medium text-[var(--text-primary)]'>Use GPT-6 Astra</span>
        <span aria-hidden='true' className='text-[var(--text-muted)] max-sm:hidden'>
          ·
        </span>
        <span className='whitespace-nowrap text-[var(--text-secondary)] max-sm:hidden'>
          Now available
        </span>
      </span>
    </ChipLink>
  )
}
