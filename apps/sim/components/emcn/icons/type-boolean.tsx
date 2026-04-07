import type { SVGProps } from 'react'

/**
 * Type boolean icon component - checkbox for boolean columns
 * @param props - SVG properties including className, fill, etc.
 */
export function TypeBoolean(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1.75 -1.5 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <rect x='2.5' y='2.75' width='15.5' height='15.5' rx='2.5' />
      <path d='M6.25 10.75L9.25 13.75L14.25 7.25' />
    </svg>
  )
}
