'use client'

import Link from 'next/link'

interface BrowseSectionProps {
  label: string
  trailing?: React.ReactNode
  children: React.ReactNode
}

/** A labelled group of browse rows, as the chat panel's new tab shows them. */
export function BrowseSection({ label, trailing, children }: BrowseSectionProps) {
  return (
    <section className='flex flex-col gap-1'>
      <div className='flex h-[24px] items-center justify-between px-2'>
        <span className='text-[var(--text-muted)] text-caption'>{label}</span>
        {trailing}
      </div>
      {children}
    </section>
  )
}

const ROW_CLASS =
  'flex h-[30px] w-full items-center gap-2 rounded-lg px-2 text-left text-small transition-colors hover-hover:bg-[var(--surface-hover)]'

interface BrowseRowProps {
  href?: string
  onClick?: () => void
  children: React.ReactNode
}

/** One browse row: a link when it navigates, a button when it changes what the panel shows. */
export function BrowseRow({ href, onClick, children }: BrowseRowProps) {
  if (href) {
    return (
      <Link href={href} className={ROW_CLASS}>
        {children}
      </Link>
    )
  }
  return (
    <button type='button' onClick={onClick} className={ROW_CLASS}>
      {children}
    </button>
  )
}
