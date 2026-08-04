import type { SVGProps } from 'react'

/**
 * FolderOpen icon component - folder with its front panel tilted open
 * @param props - SVG properties including className, fill, etc.
 */
export function FolderOpen(props: SVGProps<SVGSVGElement>) {
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
      <path d='M3.75 17.25A2 2 0 0 1 1.75 15.25V4.25A2 2 0 0 1 3.75 2.25H7L9.5 5.25H14.5A2 2 0 0 1 16.5 7.25V9.25' />
      <path d='M6.25 9.25H18.75L16.25 17.25H3.75Z' />
    </svg>
  )
}
