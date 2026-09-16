import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

export const PAGE_CONTENT_WIDTH = 'mx-auto w-full max-w-[1728px]'
export const PAGE_GUTTER = 'px-10 max-md:px-7 max-lg:px-8 max-xl:px-9'

export interface StatusPageContentProps {
  title: string
  description: string
  children: ReactNode
  titleId?: string
  detail?: ReactNode
}

/** Shared content for browser errors and the desktop's offline recovery pages. */
export function StatusPageContent({
  title,
  description,
  children,
  titleId,
  detail,
}: StatusPageContentProps) {
  return (
    <div className='flex w-full max-w-[410px] flex-col items-center gap-3 text-center'>
      <h1
        id={titleId}
        className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'
      >
        {title}
      </h1>
      <p className='text-[var(--text-body)] text-lg'>{description}</p>
      <div className='mt-3 flex flex-wrap items-center justify-center gap-2'>{children}</div>
      {detail}
    </div>
  )
}

export interface LogoPageProps {
  logo: ReactNode
  children: ReactNode
  titleBar?: ReactNode
  center?: boolean
  footer?: ReactNode
  theme?: 'light' | 'inherit'
  className?: string
}

/** Logo-only frame shared by web status pages and bundled desktop pages. */
export function LogoPage({
  logo,
  children,
  titleBar,
  center = false,
  footer,
  theme = 'inherit',
  className,
}: LogoPageProps) {
  return (
    <div
      className={cn(
        'relative flex min-h-screen flex-col bg-[var(--bg)] text-[var(--text-primary)]',
        theme === 'light' && 'light',
        className
      )}
    >
      {titleBar}
      <header>
        <nav className={cn('flex items-center py-4', PAGE_CONTENT_WIDTH, PAGE_GUTTER)}>{logo}</nav>
      </header>
      <main
        className={cn('flex flex-1 flex-col', center && 'items-center justify-center px-4 pb-16')}
      >
        {children}
      </main>
      {footer}
    </div>
  )
}
