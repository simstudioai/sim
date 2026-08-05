import type { SVGProps } from 'react'

/**
 * BubbleChat icon component - displays a rounded speech bubble with three dots
 * @param props - SVG properties including className, fill, etc.
 */
export function BubbleChat(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 5.25C0.75 3.04 2.54 1.25 4.75 1.25H15.75C17.96 1.25 19.75 3.04 19.75 5.25V11.75C19.75 13.96 17.96 15.75 15.75 15.75H9.25L5.75 19.25V15.75H4.75C2.54 15.75 0.75 13.96 0.75 11.75V5.25Z' />
      <circle cx='6.25' cy='8.5' r='1' fill='currentColor' stroke='none' />
      <circle cx='10.25' cy='8.5' r='1' fill='currentColor' stroke='none' />
      <circle cx='14.25' cy='8.5' r='1' fill='currentColor' stroke='none' />
    </svg>
  )
}
