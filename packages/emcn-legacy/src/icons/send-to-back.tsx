import type { SVGProps } from 'react'

/**
 * SendToBack icon component - a solid rounded square in front of a clipped one behind it
 * @param props - SVG properties including className, fill, etc.
 */
export function SendToBack(props: SVGProps<SVGSVGElement>) {
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
      <path d='M7.25 6.75V2.75A2 2 0 0 1 9.25 0.75H17.25A2 2 0 0 1 19.25 2.75V10.75A2 2 0 0 1 17.25 12.75H13.25' />
      <rect x='1.25' y='6.75' width='12' height='12' rx='2' />
    </svg>
  )
}
