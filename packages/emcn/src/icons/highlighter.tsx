import type { SVGProps } from 'react'

/**
 * Highlighter icon component - chisel-tip marker angled up-right above a highlighted bar
 * @param props - SVG properties including className, fill, etc.
 */
export function Highlighter(props: SVGProps<SVGSVGElement>) {
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
      <path d='M13.2 1.5L17.15 5.45L10.45 12.15L7.4 13.9L4.7 11.2L6.45 8.2Z' />
      <path d='M6.45 8.2L10.45 12.15' />
      <path d='M3.5 18H14.7' />
    </svg>
  )
}
