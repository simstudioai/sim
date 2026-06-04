import type { SVGProps } from 'react'

/**
 * Play icon component (filled/solid version)
 * @param props - SVG properties including className, fill, etc.
 */
export function Play(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='10'
      height='10'
      viewBox='0 0 10 10'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path
        d='M6.13 1.7C7.08 2.24 7.83 2.66 8.37 3.05C8.9 3.44 9.3 3.85 9.44 4.4C9.55 4.79 9.55 5.21 9.44 5.6C9.3 6.15 8.9 6.56 8.37 6.95C7.83 7.34 7.08 7.76 6.13 8.3L6.13 8.3L6.13 8.3C5.21 8.83 4.44 9.27 3.85 9.52C3.25 9.77 2.71 9.9 2.19 9.75C1.8 9.64 1.45 9.43 1.16 9.15C0.78 8.76 0.63 8.22 0.55 7.58C0.48 6.93 0.48 6.1 0.48 5.03V5.03V4.97V4.97C0.48 3.9 0.48 3.07 0.55 2.42C0.63 1.78 0.78 1.24 1.16 0.85C1.45 0.57 1.8 0.36 2.19 0.25C2.71 0.1 3.25 0.23 3.85 0.48C4.44 0.73 5.21 1.17 6.13 1.7L6.13 1.7Z'
        fill='currentColor'
      />
    </svg>
  )
}

/**
 * Play icon component (stroke/outline version)
 * @param props - SVG properties including className, stroke, etc.
 */
export function PlayOutline(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M14.26 5.39C16.17 6.48 17.67 7.33 18.73 8.11C19.81 8.89 20.6 9.71 20.89 10.79C21.09 11.58 21.09 12.42 20.89 13.21C20.6 14.29 19.81 15.11 18.73 15.89C17.67 16.67 16.17 17.52 14.26 18.61C12.42 19.65 10.87 20.53 9.69 21.04C8.51 21.54 7.42 21.8 6.37 21.5C5.6 21.28 4.89 20.86 4.33 20.29C3.56 19.51 3.25 18.44 3.1 17.15C2.96 15.87 2.96 14.19 2.96 12.06V11.94C2.96 9.81 2.96 8.13 3.1 6.85C3.25 5.56 3.56 4.49 4.33 3.71C4.89 3.14 5.6 2.72 6.37 2.5C7.42 2.2 8.51 2.46 9.69 2.96C10.87 3.47 12.42 4.35 14.26 5.39Z' />
    </svg>
  )
}
