import type { SVGProps } from 'react'

/**
 * SelectAll icon component - four L-shaped corner brackets indicating a selection region
 * @param props - SVG properties including className, fill, etc.
 */
export function SelectAll(props: SVGProps<SVGSVGElement>) {
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
      aria-hidden='true'
      {...props}
    >
      <path d='M8 4H4V8' />
      <path d='M16 4H20V8' />
      <path d='M20 16V20H16' />
      <path d='M8 20H4V16' />
    </svg>
  )
}
