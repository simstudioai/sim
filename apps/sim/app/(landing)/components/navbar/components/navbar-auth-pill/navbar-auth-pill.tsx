import { cn } from '@sim/emcn'
import Link from 'next/link'
import { LOGIN_HREF, SIGNUP_HREF } from '@/app/(landing)/constants'

interface NavbarAuthPillProps {
  size?: 'compact' | 'default'
  className?: string
  onNavigate?: () => void
}

const SEGMENT_CLASSES =
  'relative inline-flex min-w-0 items-center justify-center whitespace-nowrap text-[var(--text-body)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-[-3px] motion-reduce:transition-none'

/** Two independent account links share one pill and a short inset divider. */
export function NavbarAuthPill({ size = 'compact', className, onNavigate }: NavbarAuthPillProps) {
  const compact = size === 'compact'

  return (
    <div
      role='group'
      aria-label='Account actions'
      className={cn(
        'inline-flex shrink-0 items-stretch rounded-full border border-[var(--border)]',
        compact ? 'h-[26px] text-[13px]' : 'h-9 text-[14px]',
        className
      )}
    >
      <Link
        href={LOGIN_HREF}
        prefetch={false}
        onClick={onNavigate}
        className={cn(SEGMENT_CLASSES, 'rounded-l-full', compact ? 'px-3' : 'flex-auto px-2')}
      >
        Log in
      </Link>
      <span
        aria-hidden='true'
        className={cn('w-px shrink-0 self-center bg-[var(--border)]', compact ? 'h-3' : 'h-3.5')}
      />
      <Link
        href={SIGNUP_HREF}
        prefetch={false}
        onClick={onNavigate}
        className={cn(SEGMENT_CLASSES, 'rounded-r-full', compact ? 'px-3' : 'flex-auto px-2')}
      >
        Start building
      </Link>
    </div>
  )
}
