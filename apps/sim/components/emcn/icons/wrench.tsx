import type { SVGProps } from 'react'

/**
 * Wrench icon component - adjustable wrench tool
 * @param props - SVG properties including className, fill, etc.
 */
export function Wrench(props: SVGProps<SVGSVGElement>) {
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
      <path d='M15.09 1.41C13.78 0.74 12.25 0.63 10.85 1.11C9.45 1.59 8.3 2.62 7.68 3.96C7.06 5.3 7.02 6.84 7.57 8.2L1.25 14.52C0.86 14.91 0.86 15.54 1.25 15.93L3.57 18.25C3.96 18.64 4.59 18.64 4.98 18.25L11.3 11.93C12.66 12.48 14.2 12.44 15.54 11.82C16.88 11.2 17.91 10.05 18.39 8.65C18.87 7.25 18.76 5.72 18.09 4.41L14.87 7.63L12.25 7.25L11.87 4.63L15.09 1.41Z' />
    </svg>
  )
}
