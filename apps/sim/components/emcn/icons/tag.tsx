import type { SVGProps } from 'react'

/**
 * Tag icon component - price tag / label
 * @param props - SVG properties including className, fill, etc.
 */
export function TagIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 9.75V3.25C0.75 1.86929 1.86929 0.75 3.25 0.75H9.75L19.25 10.25L10.25 19.25L0.75 9.75Z' />
      <circle cx='5.75' cy='5.75' r='1.25' />
    </svg>
  )
}
