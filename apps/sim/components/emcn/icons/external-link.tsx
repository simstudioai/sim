import type { SVGProps } from 'react'

/**
 * ExternalLink icon component - arrow pointing out of a box
 * @param props - SVG properties including className, fill, etc.
 */
export function ExternalLink(props: SVGProps<SVGSVGElement>) {
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
      <path d='M11.75 0.75H19.25V8.25' />
      <path d='M19.25 0.75L9.25 10.75' />
      <path d='M16.25 11.75V16.25C16.25 17.6307 15.1307 18.75 13.75 18.75H3.25C1.86929 18.75 0.75 17.6307 0.75 16.25V5.75C0.75 4.36929 1.86929 3.25 3.25 3.25H7.75' />
    </svg>
  )
}
