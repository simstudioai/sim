import type { SVGProps } from 'react'

/**
 * Phone icon component - angled handset outline, centred so a 135 degree rotation reads as hang up
 * @param props - SVG properties including className, fill, etc.
 */
export function Phone(props: SVGProps<SVGSVGElement>) {
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
      <path d='M18.74 13.99V16.55A1.71 1.71 0 0 1 16.88 18.26A16.9 16.9 0 0 1 9.51 15.63A16.65 16.65 0 0 1 4.38 10.51A16.9 16.9 0 0 1 1.76 3.11A1.71 1.71 0 0 1 3.46 1.24H6.02A1.71 1.71 0 0 1 7.73 2.71A10.97 10.97 0 0 0 8.33 5.11A1.71 1.71 0 0 1 7.94 6.92L6.86 8A13.66 13.66 0 0 0 11.98 13.12L13.07 12.04A1.71 1.71 0 0 1 14.87 11.65A10.97 10.97 0 0 0 17.27 12.25A1.71 1.71 0 0 1 18.74 13.99Z' />
    </svg>
  )
}
