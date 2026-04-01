import type { SVGProps } from 'react'

/**
 * Database-X icon component - cylinder database with an X mark indicating a missing or deleted knowledge base
 * @param props - SVG properties including className, fill, etc.
 */
export function DatabaseX(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1 -2 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <ellipse cx='10.25' cy='3.75' rx='8.5' ry='3' />
      <path d='M1.75 3.75V9.75C1.75 11.41 5.55 12.75 10.25 12.75C14.95 12.75 18.75 11.41 18.75 9.75V3.75' />
      <path d='M1.75 9.75V12.5' />
      <path d='M18.75 9.75V15.75C18.75 17.41 14.95 18.75 10.25 18.75C9 18.75 7.75 18.6 6.75 18.3' />
      <path d='M1 16L5 20' />
      <path d='M5 16L1 20' />
    </svg>
  )
}
