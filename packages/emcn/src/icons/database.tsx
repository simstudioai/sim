import type { SVGProps } from 'react'

/**
 * Database icon component - cylinder with a single tier divider
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
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <ellipse cx='10.25' cy='4.25' rx='7.5' ry='3.25' />
      <path d='M2.75 4.25V15.25C2.75 17.05 6.11 18.5 10.25 18.5C14.39 18.5 17.75 17.05 17.75 15.25V4.25' />
      <path d='M2.75 9.75C2.75 11.55 6.11 13 10.25 13C14.39 13 17.75 11.55 17.75 9.75' />
    </svg>
  )
}
