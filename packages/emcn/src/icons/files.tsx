import type { SVGProps } from 'react'

/**
 * Files icon component - a document with a folded corner over a second sheet
 * @param props - SVG properties including className, fill, etc.
 */
export function Files(props: SVGProps<SVGSVGElement>) {
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
      <path d='M2.25 13.25V3.75C2.25 2.65 3.15 1.75 4.25 1.75H11.25' />
      <path d='M5.25 6.75C5.25 5.65 6.15 4.75 7.25 4.75H13.25L18.75 10.25V16.75C18.75 17.85 17.85 18.75 16.75 18.75H7.25C6.15 18.75 5.25 17.85 5.25 16.75V6.75Z' />
      <path d='M13.25 4.75V10.25H18.75' />
    </svg>
  )
}
