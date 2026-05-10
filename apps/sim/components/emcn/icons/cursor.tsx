import type { SVGProps } from 'react'

export function Cursor(props: SVGProps<SVGSVGElement>) {
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
        d='M20.51 10.78C21.12 10.54 21.431 10.42 21.52 10.25C21.59 10.099 21.59 9.92 21.51 9.78C21.42 9.61 21.109 9.5 20.486 9.28L4.6 3.57C4.09 3.39 3.83 3.3 3.67 3.36C3.52 3.41 3.41 3.52 3.36 3.66C3.3 3.83 3.39 4.09 3.57 4.6L9.277 20.49C9.5 21.11 9.61 21.42 9.78 21.51C9.92 21.59 10.1 21.59 10.25 21.52C10.42 21.43 10.54 21.12 10.78 20.51L13.37 13.83C13.42 13.707 13.44 13.65 13.48 13.6C13.51 13.55 13.55 13.51 13.6 13.479C13.65 13.44 13.71 13.42 13.828 13.37L20.51 10.78Z'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
