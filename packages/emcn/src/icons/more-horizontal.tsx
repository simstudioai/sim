import type { SVGProps } from 'react'

/**
 * MoreHorizontal icon component (three horizontal dots)
 *
 * The exact transpose of {@link MoreVertical} about (10.25, 9.75) — same radius,
 * same stroke, same 6-unit spacing. The two are the same glyph rotated 90deg and
 * appear in the same overflow-menu role, so they must match by construction
 * rather than by coincidence.
 *
 * @param props - SVG properties including className, fill, etc.
 */
export function MoreHorizontal(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1 -2 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <circle cx='4.25' cy='9.75' r='0.75' />
      <circle cx='10.25' cy='9.75' r='0.75' />
      <circle cx='16.25' cy='9.75' r='0.75' />
    </svg>
  )
}
