import type { SVGProps } from 'react'

/** Archive icon. Callers provide size and color through SVG props. */
export function ZipIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
      <path d='M14 2v4a2 2 0 0 0 2 2h4' />
      <path d='M10 5h1' />
      <path d='M11 8h1' />
      <path d='M10 11h1' />
      <rect x='9' y='14' width='4' height='5' rx='1' />
    </svg>
  )
}
