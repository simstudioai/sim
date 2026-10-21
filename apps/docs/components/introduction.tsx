import type { ReactNode } from 'react'
import { ArrowRight, MessageSquareText, TerminalWindow, Workflow } from '@sim/emcn/icons'
import Image from 'next/image'
import Link from 'next/link'

const BUILD_PATH_ICONS = {
  chat: MessageSquareText,
  workflow: Workflow,
  api: TerminalWindow,
} as const

interface IntroductionHeroProps {
  alt: string
}

interface IntroductionLinkProps {
  href: string
  title: string
  icon: keyof typeof BUILD_PATH_ICONS
  children: ReactNode
}

export function IntroductionHero({ alt }: IntroductionHeroProps) {
  return (
    <figure className='not-prose relative my-8 aspect-[50/19] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] max-sm:aspect-[2/1]'>
      <Image
        src='/static/introduction/san-francisco.webp'
        alt=''
        fill
        loading='eager'
        className='object-cover object-[center_32%]'
      />
      <div className='absolute top-[18.4%] left-[11%] w-[78%] overflow-hidden rounded-t-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-overlay)] max-sm:top-[14%] max-sm:left-[6%] max-sm:w-[88%]'>
        <Image
          src='/static/introduction/platform.webp'
          alt={alt}
          width={2400}
          height={1200}
          preload
          className='block h-auto w-full'
        />
      </div>
    </figure>
  )
}

export function IntroductionLink({ href, title, icon, children }: IntroductionLinkProps) {
  const Icon = BUILD_PATH_ICONS[icon]

  return (
    <Link
      href={href}
      className='group grid min-h-16 grid-cols-[20px_minmax(0,1fr)_16px] items-center gap-x-4 gap-y-1 border-[var(--border)] border-t px-3 py-4 text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4 sm:grid-cols-[20px_minmax(10rem,0.9fr)_minmax(0,1.6fr)_16px] sm:px-4'
    >
      <Icon aria-hidden className='size-5 shrink-0 text-[var(--text-icon)]' />
      <span className='font-medium text-base'>{title}</span>
      <div className='col-start-2 row-start-2 text-pretty text-[var(--text-body)] text-sm leading-relaxed sm:col-start-3 sm:row-start-1 [&>p]:m-0'>
        {children}
      </div>
      <ArrowRight
        aria-hidden
        className='col-start-3 row-start-1 size-4 shrink-0 text-[var(--text-icon)] group-hover:text-[var(--text-primary)] sm:col-start-4'
      />
    </Link>
  )
}
