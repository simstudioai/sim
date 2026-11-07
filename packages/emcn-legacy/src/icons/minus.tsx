import type { SVGProps } from 'react'

/**
 * Minus icon component - single horizontal bar matching the horizontal stroke of Plus
 * @param props - SVG properties including className, fill, etc.
 */
export function Minus(props: SVGProps<SVGSVGElement>) {
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
      <path d='M3 10.25H17.5' />
    </svg>
  )
}
