import type { SVGProps } from 'react'

/**
 * Bell icon component - notification bell
 * @param props - SVG properties including className, fill, etc.
 */
export function Bell(props: SVGProps<SVGSVGElement>) {
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
      <path d='M15.25 6.75C15.25 5.35761 14.6969 4.02226 13.7123 3.03769C12.7277 2.05312 11.3924 1.5 10 1.5C8.60761 1.5 7.27226 2.05312 6.28769 3.03769C5.30312 4.02226 4.75 5.35761 4.75 6.75C4.75 12.75 2.25 14.5 2.25 14.5H17.75C17.75 14.5 15.25 12.75 15.25 6.75Z' />
      <path d='M11.4425 17.75C11.2655 18.0547 11.0133 18.3088 10.7101 18.4882C10.4068 18.6676 10.0627 18.7662 9.71 18.7749C9.35735 18.7836 9.00888 18.7022 8.69728 18.5381C8.38568 18.374 8.12138 18.1327 7.92999 17.8375' />
    </svg>
  )
}
