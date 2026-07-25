import type { SVGProps } from 'react'

/**
 * Split icon component - one path branching into two
 * @param props - SVG properties including className, fill, etc.
 */
export function Split(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      {...props}
    >
      <path d='M16 3h5v5' />
      <path d='M8 3H3v5' />
      <path d='M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3' />
      <path d='m15 9 6-6' />
    </svg>
  )
}
