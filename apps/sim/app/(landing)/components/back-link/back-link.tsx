import Link from 'next/link'

/**
 * The canonical "Back to X" link for the landing family - a muted text link with
 * a left chevron whose shaft draws in on hover. Single source of truth, reused by
 * the blog post, integration, and model detail pages so the back affordance can't
 * drift. Season is the global body font; color uses the platform muted→primary
 * hover idiom.
 */
interface BackLinkProps {
  href: string
  label: string
}

export function BackLink({ href, label }: BackLinkProps) {
  return (
    <Link
      href={href}
      className='group/link inline-flex items-center gap-1.5 text-[var(--text-muted)] text-sm tracking-[0.02em] hover:text-[var(--text-primary)]'
    >
      <svg
        className='size-3 shrink-0'
        viewBox='0 0 10 10'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        aria-hidden='true'
      >
        <line
          x1='1'
          y1='5'
          x2='10'
          y2='5'
          stroke='currentColor'
          strokeWidth='1.33'
          strokeLinecap='square'
          className='origin-right scale-x-0 transition-transform duration-200 ease-out [transform-box:fill-box] group-hover/link:scale-x-100'
        />
        <path
          d='M6.5 2L3.5 5L6.5 8'
          stroke='currentColor'
          strokeWidth='1.33'
          strokeLinecap='square'
          strokeLinejoin='miter'
          fill='none'
          className='group-hover/link:-translate-x-[30%] transition-transform duration-200 ease-out'
        />
      </svg>
      {label}
    </Link>
  )
}
