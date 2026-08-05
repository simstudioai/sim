import type { SVGProps } from 'react'

/**
 * Ban icon component - prohibition sign, a circle crossed by one diagonal bar
 * @param props - SVG properties including className, fill, etc.
 */
export function Ban(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='10.25' cy='9.75' r='9' />
      <path d='M3.89 3.39L16.61 16.11' />
    </svg>
  )
}
