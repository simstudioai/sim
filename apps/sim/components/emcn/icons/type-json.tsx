import type { SVGProps } from 'react'

/**
 * Type JSON icon component - curly braces for JSON columns
 * @param props - SVG properties including className, fill, etc.
 */
export function TypeJson(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1.75 -1.75 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M5.75 1.25C3.54 1.25 1.75 3.04 1.75 5.25V7.75C1.75 9.13 0.63 10.25 -0.75 10.25C0.63 10.25 1.75 11.37 1.75 12.75V15.25C1.75 17.46 3.54 19.25 5.75 19.25' />
      <path d='M14.75 1.25C16.96 1.25 18.75 3.04 18.75 5.25V7.75C18.75 9.13 19.87 10.25 21.25 10.25C19.87 10.25 18.75 11.37 18.75 12.75V15.25C18.75 17.46 16.96 19.25 14.75 19.25' />
    </svg>
  )
}
