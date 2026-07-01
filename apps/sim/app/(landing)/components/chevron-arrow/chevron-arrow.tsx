/**
 * The animated chevron used on landing link rows (models, integrations). On
 * `group-hover/link` the leading line draws in and the arrowhead nudges right.
 * Decorative, so `aria-hidden`.
 */
export function ChevronArrow() {
  return (
    <svg
      className='size-3 shrink-0 text-[var(--text-muted)]'
      viewBox='0 0 10 10'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
    >
      <line
        x1='0'
        y1='5'
        x2='9'
        y2='5'
        stroke='currentColor'
        strokeWidth='1.33'
        strokeLinecap='square'
        className='origin-left scale-x-0 transition-transform duration-200 ease-out [transform-box:fill-box] group-hover/link:scale-x-100'
      />
      <path
        d='M3.5 2L6.5 5L3.5 8'
        stroke='currentColor'
        strokeWidth='1.33'
        strokeLinecap='square'
        strokeLinejoin='miter'
        fill='none'
        className='transition-transform duration-200 ease-out group-hover/link:translate-x-[30%]'
      />
    </svg>
  )
}
