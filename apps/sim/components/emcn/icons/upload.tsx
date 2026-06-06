import type { SVGProps } from 'react'

/**
 * Upload icon component - arrow pointing up with base line
 * @param props - SVG properties including className, fill, etc.
 */
export function Upload(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 12.75V16.75C0.75 17.8546 1.64543 18.75 2.75 18.75H17.75C18.8546 18.75 19.75 17.8546 19.75 16.75V12.75' />
      <path d='M10.25 14.75V1.75' />
      <path d='M5.25 6.75L10.25 1.75L15.25 6.75' />
    </svg>
  )
}
