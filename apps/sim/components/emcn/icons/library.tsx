import type { SVGProps } from 'react'

/**
 * Library icon component - displays stacked books/documents
 * @param props - SVG properties including className, fill, etc.
 */
export function Library(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 4.75C0.75 3.35 0.75 2.65 1.02 2.12C1.26 1.64 1.64 1.26 2.12 1.02C2.65 0.75 3.35 0.75 4.75 0.75C6.15 0.75 6.85 0.75 7.38 1.02C7.86 1.26 8.24 1.64 8.48 2.12C8.75 2.65 8.75 3.35 8.75 4.75V14.75C8.75 16.15 8.75 16.85 8.48 17.385C8.24 17.86 7.86 18.24 7.38 18.48C6.85 18.75 6.15 18.75 4.75 18.75C3.35 18.75 2.65 18.75 2.12 18.48C1.64 18.24 1.26 17.86 1.02 17.385C0.75 16.85 0.75 16.15 0.75 14.75V4.75Z' />
      <path d='M0.75 6.75H8.75' />
      <path d='M10.2 6.02C9.84 4.69 9.67 4.02 9.79 3.45C9.9 2.94 10.16 2.48 10.55 2.13C10.98 1.74 11.64 1.56 12.97 1.2C14.29 0.84 14.96 0.67 15.53 0.79C16.04 0.9 16.49 1.16 16.84 1.55C17.23 1.99 17.41 2.65 17.77 3.98L20.3 13.48C20.66 14.81 20.83 15.48 20.71 16.054C20.604 16.56 20.34 17.02 19.95 17.37C19.52 17.76 18.86 17.94 17.53 18.3C16.21 18.66 15.54 18.83 14.97 18.71C14.46 18.6 14.01 18.34 13.66 17.95C13.27 17.51 13.09 16.85 12.73 15.52L10.2 6.02Z' />
      <path d='M10.75 7.75L17.25 5.75' />
    </svg>
  )
}
