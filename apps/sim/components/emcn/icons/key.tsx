import type { SVGProps } from 'react'

/**
 * Key icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function Key(props: SVGProps<SVGSVGElement>) {
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
      {...props}
    >
      <circle cx='6.75' cy='10.25' r='3.5' />
      <path d='M10.25 10.25H19' />
      <path d='M14.5 10.25V13.5' />
      <path d='M17.5 10.25V12.5' />
    </svg>
  )
}
