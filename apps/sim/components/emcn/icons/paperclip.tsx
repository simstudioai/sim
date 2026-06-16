import type { SVGProps } from 'react'

/**
 * Paperclip icon component - attachment clip
 * @param props - SVG properties including className, fill, etc.
 */
export function Paperclip(props: SVGProps<SVGSVGElement>) {
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
      <g transform='rotate(-13.6501 10.25 10.25)'>
        <path d='M18.25 9.75L10.4 17.6C8.46 19.54 5.31 19.54 3.37 17.6C1.43 15.66 1.43 12.51 3.37 10.57L11.22 2.72C12.51 1.43 14.61 1.43 15.9 2.72C17.19 4.01 17.19 6.11 15.9 7.4L8.05 15.25C7.4 15.9 6.35 15.9 5.7 15.25C5.05 14.6 5.05 13.55 5.7 12.9L12.9 5.7' />
      </g>
    </svg>
  )
}
