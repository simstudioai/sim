import type { SVGProps } from 'react'

/**
 * NoWrap icon component - shows text extending horizontally without wrapping
 * @param props - SVG properties including className, fill, etc.
 */
export function NoWrap(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path d='M3 8h18' />
      <path d='M3 12h18' />
      <path d='M3 16h15' />
      <path d='m21 16-3 3' />
      <path d='m21 16-3-3' />
    </svg>
  )
}
