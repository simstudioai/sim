import type { SVGProps } from 'react'

/**
 * BrainCircuit icon component - half brain with circuit traces branching to node dots
 * @param props - SVG properties including className, fill, etc.
 */
export function BrainCircuit(props: SVGProps<SVGSVGElement>) {
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
      <path d='M9.5 3.2C8.4 2.1 6.6 2.2 5.7 3.45C4 3.6 2.95 5.3 3.45 6.95C2.1 7.85 2.1 9.85 3.45 10.75C2.85 12.4 3.8 14.2 5.5 14.6C5.8 16.45 7.8 17.55 9.5 16.85Z' />
      <path d='M9.5 7.3H13.1V4.6H15.9M9.5 12.6H13.1V15.2H15.9' />
      <circle cx='16.9' cy='4.6' r='1' />
      <circle cx='16.9' cy='15.2' r='1' />
    </svg>
  )
}
