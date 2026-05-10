import type { SVGProps } from 'react'

/**
 * FolderPlus icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function FolderPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path
        d='M10.3 20H4C3.47 20 2.96 19.79 2.59 19.41C2.21 19.04 2 18.53 2 18V5C2 4.47 2.21 3.96 2.59 3.59C2.96 3.21 3.47 3 4 3H7.98C8.31 3 8.64 3.08 8.94 3.23C9.23 3.39 9.49 3.62 9.67 3.9L10.33 5.1C10.51 5.38 10.76 5.6 11.05 5.76C11.343 5.92 11.67 6 12 6H20C20.53 6 21.04 6.21 21.41 6.59C21.79 6.96 22 7.47 22 8V11.3'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M18 15V21'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M15 18H21'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
