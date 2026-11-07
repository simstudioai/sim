import type { SVGProps } from 'react'

/**
 * Wand icon component - angled wand with sparkles at its tip
 * @param props - SVG properties including className, fill, etc.
 */
export function Wand(props: SVGProps<SVGSVGElement>) {
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
      <path d='M1.17 15.73L10.97 5.93L13.51 8.47L3.71 18.27Z' />
      <path d='M16.09 1.2C16.09 2.86 17.03 3.8 18.69 3.8C17.03 3.8 16.09 4.74 16.09 6.4C16.09 4.74 15.15 3.8 13.49 3.8C15.15 3.8 16.09 2.86 16.09 1.2Z' />
      <path d='M17.69 9.05C17.69 10.11 18.28 10.7 19.34 10.7C18.28 10.7 17.69 11.29 17.69 12.35C17.69 11.29 17.1 10.7 16.04 10.7C17.1 10.7 17.69 10.11 17.69 9.05Z' />
    </svg>
  )
}
