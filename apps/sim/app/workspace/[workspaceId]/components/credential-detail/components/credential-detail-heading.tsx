import type { ReactNode } from 'react'

interface CredentialDetailHeadingProps {
  /** Leading visual (icon tile or brand tile). */
  leading: ReactNode
  title: ReactNode
  subtitle?: ReactNode
}

/**
 * Header row shared by credential detail surfaces: a leading visual beside a
 * title over a muted subtitle.
 */
export function CredentialDetailHeading({
  leading,
  title,
  subtitle,
}: CredentialDetailHeadingProps) {
  return (
    <div className='flex items-center gap-2.5'>
      {leading}
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-[14px] text-[var(--text-body)]'>{title}</span>
        {subtitle ? (
          <span className='truncate text-[12px] text-[var(--text-muted)]'>{subtitle}</span>
        ) : null}
      </div>
    </div>
  )
}
