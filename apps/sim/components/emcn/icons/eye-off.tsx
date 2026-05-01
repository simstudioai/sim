import type { SVGProps } from 'react'

/**
 * Eye-off icon. Companion to {@link Eye}; used for "hide" affordances where
 * something is being concealed without being destroyed (e.g. hide a workflow
 * output column from the table while keeping it re-addable from the sidebar).
 *
 * Uses currentColor so it inherits the surrounding text color.
 *
 * @param props - SVG properties including className, fill, etc.
 */
export function EyeOff(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='14'
      height='14'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M9.88 9.88a3 3 0 1 0 4.24 4.24' />
      <path d='M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68' />
      <path d='M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61' />
      <line x1='2' y1='2' x2='22' y2='22' />
    </svg>
  )
}
