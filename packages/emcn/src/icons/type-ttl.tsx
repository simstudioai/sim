import type { SVGProps } from 'react'

export function TypeTtl(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1.75 -1.5 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <circle cx='10.25' cy='10.5' r='7.75' />
      <path d='M10.25 6V10.5L13.5 12.5' />
    </svg>
  )
}
