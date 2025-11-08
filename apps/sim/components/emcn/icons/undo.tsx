import type { SVGProps } from 'react'

/**
 * Undo icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function Undo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='12'
      height='12'
      viewBox='0 0 12 12'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path
        d='M2.5 4.5H8C9.38071 4.5 10.5 5.61929 10.5 7C10.5 8.38071 9.38071 9.5 8 9.5H5'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M4 2.5L2 4.5L4 6.5'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
