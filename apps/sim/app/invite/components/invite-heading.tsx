import type { ReactNode } from 'react'

interface InviteHeadingProps {
  title: ReactNode
  children: ReactNode
}

/** Heading shared by invitation and email-preference states; subcopy stays with each caller. */
export function InviteHeading({ title, children }: InviteHeadingProps) {
  return (
    <div className='space-y-1 text-center'>
      <h1 className='text-[32px] text-[var(--text-primary)] tracking-tight'>{title}</h1>
      {children}
    </div>
  )
}
