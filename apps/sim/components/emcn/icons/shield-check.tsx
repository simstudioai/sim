import type { SVGProps } from 'react'

/**
 * ShieldCheck icon component - shield with checkmark
 * @param props - SVG properties including className, fill, etc.
 */
export function ShieldCheck(props: SVGProps<SVGSVGElement>) {
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
      <path d='M10.25 1.25L2.25 5.25V10.25C2.25 15.25 5.65 19.85 10.25 20.75C14.85 19.85 18.25 15.25 18.25 10.25V5.25L10.25 1.25Z' />
      <path d='M7.25 10.75L9.25 12.75L13.25 8.75' />
    </svg>
  )
}
