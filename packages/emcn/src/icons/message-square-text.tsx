import type { SVGProps } from 'react'

/**
 * MessageSquareText icon component - speech bubble with two lines of text
 * @param props - SVG properties including className, fill, etc.
 */
export function MessageSquareText(props: SVGProps<SVGSVGElement>) {
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
      <path d='M17.99 12.33A1.72 1.72 0 0 1 16.27 14.05H5.95L2.51 17.49V3.73A1.72 1.72 0 0 1 4.23 2.01H16.27A1.72 1.72 0 0 1 17.99 3.73Z' />
      <path d='M5.95 6.31H11.11' />
      <path d='M5.95 9.75H14.55' />
    </svg>
  )
}
