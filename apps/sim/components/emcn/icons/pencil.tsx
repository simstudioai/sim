import type { SVGProps } from 'react'

/**
 * Pencil icon component - edit/rename indicator
 * @param props - SVG properties including className, fill, etc.
 */
export function Pencil(props: SVGProps<SVGSVGElement>) {
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
      <path d='M14.75 1.25L19.25 5.75L7.25 17.75H2.75V13.25L14.75 1.25Z' />
      <path d='M12 4L16.5 8.5' />
    </svg>
  )
}
