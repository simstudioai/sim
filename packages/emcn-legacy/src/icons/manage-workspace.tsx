import type { SVGProps } from 'react'

/**
 * ManageWorkspace icon component - horizontal sliders / controls
 * @param props - SVG properties including className, fill, etc.
 */
export function ManageWorkspace(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M21 4h-7' />
      <path d='M10 4H3' />
      <path d='M21 12h-9' />
      <path d='M8 12H3' />
      <path d='M21 20h-7' />
      <path d='M10 20H3' />
      <path d='M14 2v4' />
      <path d='M8 10v4' />
      <path d='M14 18v4' />
    </svg>
  )
}
