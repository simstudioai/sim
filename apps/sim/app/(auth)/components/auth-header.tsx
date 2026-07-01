import type { ReactNode } from 'react'

interface AuthHeaderProps {
  title: string
  description: ReactNode
}

/**
 * The centered heading + subcopy block shared by every auth page and status
 * page. One source of truth for auth heading typography (light tokens, normal
 * weight, no bespoke tracking — aligned with the landing scale, sized down for
 * the single-column form).
 */
export function AuthHeader({ title, description }: AuthHeaderProps) {
  return (
    <div className='space-y-1 text-center'>
      <h1 className='text-balance text-[32px] text-[var(--text-primary)] leading-[1.2]'>{title}</h1>
      <p className='text-[var(--text-muted)] text-base leading-[1.5]'>{description}</p>
    </div>
  )
}
