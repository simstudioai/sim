import type { SVGProps } from 'react'

/**
 * MessageCircle icon component - round chat bubble with tail
 * @param props - SVG properties including className, fill, etc.
 */
export function MessageCircle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      {...props}
    >
      <path d='M7.9 20A9 9 0 1 0 4 16.1L2 22Z' />
    </svg>
  )
}
