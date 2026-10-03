import type { SVGProps } from 'react'

/**
 * Infinity icon component - lemniscate drawn as one continuous stroke
 * @param props - SVG properties including className, fill, etc.
 */
export function InfinityIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d='M10.25 9.75C7.05 3.85 1.15 4.3 1.15 9.75C1.15 15.2 7.05 15.65 10.25 9.75C13.45 3.85 19.35 4.3 19.35 9.75C19.35 15.2 13.45 15.65 10.25 9.75Z' />
    </svg>
  )
}
