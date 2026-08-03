import type { SVGProps } from 'react'

/**
 * Type phone icon component - handset for phone columns
 * @param props - SVG properties including className, fill, etc.
 */
export function TypePhone(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1.75 -1.5 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      {/* The handset's own bbox centres on (10.59, 9.39); the type-* family
          centres on (10.25, 10.5). Nudged rather than re-authored so the path
          stays comparable to its source. */}
      <g transform='translate(-0.34 1.11)'>
        <path d='M6.25 2.75H8.25L9.75 6.5L7.75 7.75C8.6 9.55 10.05 11 11.85 11.85L13.1 9.85L16.85 11.35V13.35C16.85 14.9 15.55 16.15 14 15.95C10.9 15.55 5.95 12.65 4.55 8.5C3.95 6.7 4.6 2.75 6.25 2.75Z' />
      </g>
    </svg>
  )
}
