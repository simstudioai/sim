import type { SVGProps } from 'react'

/**
 * Home icon component - house with door
 * @param props - SVG properties including className, fill, etc.
 */
export function Home(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 9.5L10.25 1L19.75 9.5V16.25C19.75 17.6307 18.6307 18.75 17.25 18.75H3.25C1.86929 18.75 0.75 17.6307 0.75 16.25V9.5Z' />
      <path d='M7.25 18.75V13C7.25 12.4477 7.69772 12 8.25 12H12.25C12.8023 12 13.25 12.4477 13.25 13V18.75' />
    </svg>
  )
}
