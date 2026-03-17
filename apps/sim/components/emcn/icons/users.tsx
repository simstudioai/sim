import type { SVGProps } from 'react'

/**
 * Users icon component - two person silhouettes
 * @param props - SVG properties including className, fill, etc.
 */
export function Users(props: SVGProps<SVGSVGElement>) {
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
      {...props}
    >
      <circle cx='8.25' cy='5.75' r='3.5' />
      <path d='M0.75 18.75C0.75 14.6079 4.10786 11.25 8.25 11.25C12.3921 11.25 15.75 14.6079 15.75 18.75' />
      <path d='M14.25 0.93C15.11 0.63 16.04 0.73 16.83 1.19C17.62 1.65 18.17 2.42 18.33 3.32C18.49 4.21 18.25 5.13 17.68 5.83C17.11 6.54 16.27 6.95 15.37 6.97' />
      <path d='M16.75 11.43C18.08 11.67 19.29 12.35 20.17 13.37C21.05 14.39 21.53 15.69 21.53 17.03V18.75' />
    </svg>
  )
}
