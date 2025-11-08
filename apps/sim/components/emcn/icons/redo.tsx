import type { SVGProps } from 'react'

/**
 * Redo icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function Redo(props: SVGProps<SVGSVGElement>) {
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
        d='M9.5 4.5H4C2.61929 4.5 1.5 5.61929 1.5 7C1.5 8.38071 2.61929 9.5 4 9.5H7'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M8 2.5L10 4.5L8 6.5'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
