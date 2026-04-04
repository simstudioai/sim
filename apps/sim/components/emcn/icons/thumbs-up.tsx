import type { SVGProps } from 'react'

/**
 * ThumbsUp icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function ThumbsUp(props: SVGProps<SVGSVGElement>) {
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
      aria-hidden='true'
      {...props}
    >
      <path d='M6 8v12' />
      <path d='M14 3.88L13 8h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 16.5 20H3a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L11 0a3.13 3.13 0 0 1 3 3.88Z' />
    </svg>
  )
}
