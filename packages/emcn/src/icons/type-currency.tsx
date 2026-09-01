import type { SVGProps } from 'react'

/**
 * Type currency icon component - dollar sign for currency columns
 * @param props - SVG properties including className, fill, etc.
 */
export function TypeCurrency(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1.75 -1.5 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M10.25 2V19' />
      <path d='M15.25 6.5C15.25 4.55 13.01 3.5 10.25 3.5C7.49 3.5 5.25 4.55 5.25 7C5.25 9.45 7.49 10.5 10.25 10.5C13.01 10.5 15.25 11.55 15.25 14C15.25 16.45 13.01 17.5 10.25 17.5C7.49 17.5 5.25 16.45 5.25 14.5' />
    </svg>
  )
}
