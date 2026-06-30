import type { SVGProps } from 'react'

/**
 * MoreHorizontal icon component (three horizontal dots)
 * @param props - SVG properties including className, fill, etc.
 */
export function MoreHorizontal(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='12'
      height='3'
      viewBox='0 0 12 3'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path
        d='M10.64 2.72C10.46 2.72 10.29 2.68 10.122 2.61C9.96 2.54 9.81 2.44 9.68 2.32C9.56 2.19 9.46 2.04 9.39 1.88C9.32 1.71 9.28 1.54 9.28 1.36C9.28 1.18 9.32 1 9.39 0.84C9.45 0.67 9.55 0.52 9.68 0.4C9.81 0.27 9.96 0.17 10.12 0.1C10.286 0.04 10.46 5.74e-05 10.641 7.02e-08C11 0 11.35 0.14 11.6 0.4C11.86 0.65 12 1 12 1.36C12 1.72 11.86 2.06 11.6 2.32C11.35 2.57 11 2.72 10.64 2.72Z'
        fill='currentColor'
      />
      <path
        d='M6 2.72C6.75 2.72 7.36 2.11 7.36 1.36C7.36 0.61 6.75 0 6 0C5.25 0 4.64 0.61 4.64 1.36C4.64 2.11 5.25 2.72 6 2.72Z'
        fill='currentColor'
      />
      <path
        d='M1.36 2.72C2.11 2.72 2.72 2.11 2.72 1.36C2.72 0.61 2.11 0 1.36 0C0.61 0 0 0.61 0 1.36C0 2.11 0.61 2.72 1.36 2.72Z'
        fill='currentColor'
      />
    </svg>
  )
}
