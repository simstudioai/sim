import type { SVGProps } from 'react'

/** JSON icon. Callers provide size and color through SVG props. */
export function JsonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path d='M8 3H7a2 2 0 0 0-2 2v4c0 1.1-.9 2-2 2 1.1 0 2 .9 2 2v4a2 2 0 0 0 2 2h1' />
      <path d='M16 3h1a2 2 0 0 1 2 2v4c0 1.1.9 2 2 2-1.1 0-2 .9-2 2v4a2 2 0 0 1-2 2h-1' />
    </svg>
  )
}
