import type { SVGProps } from 'react'

/**
 * FileText icon component - document with folded corner and text lines
 * @param props - SVG properties including className, fill, etc.
 */
export function FileText(props: SVGProps<SVGSVGElement>) {
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
      <path d='M12.25 0.75H5.25C4.15 0.75 3.25 1.65 3.25 2.75V16.75C3.25 17.85 4.15 18.75 5.25 18.75H15.25C16.35 18.75 17.25 17.85 17.25 16.75V5.75L12.25 0.75Z' />
      <path d='M12.25 0.75V5.75H17.25' />
      <path d='M6.75 9.75H10.25M6.75 12.75H13.75M6.75 15.75H13.75' />
    </svg>
  )
}
