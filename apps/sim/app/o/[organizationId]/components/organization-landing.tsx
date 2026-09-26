import type { ReactNode } from 'react'
import { cn, pageHeadingClassName } from '@sim/emcn'

interface OrganizationLandingProps {
  heading: string
  children: ReactNode
}

/** Keeps the Home and Search composers centered independently of the shortcuts below them. */
export function OrganizationLanding({ heading, children }: OrganizationLandingProps) {
  return (
    <div className='min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'>
      <div className='flex min-h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[22vh]'>
        <h1 className={cn(pageHeadingClassName, 'mb-7 max-w-chat')}>{heading}</h1>
        <div className='relative w-full max-w-chat'>{children}</div>
      </div>
    </div>
  )
}
