import type { SVGProps } from 'react'

/**
 * Database icon component - cylinder with horizontal dividers
 * @param props - SVG properties including className, fill, etc.
 */
export function Database(props: SVGProps<SVGSVGElement>) {
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
      <path d='M1.75 9.75V15.75C1.75 17.41 5.55 18.75 10.25 18.75C14.95 18.75 18.75 17.41 18.75 15.75V9.75' />
    </svg>
  )
}
