import type { SVGProps } from 'react'

/** HTML icon. Callers provide size and color through SVG props. */
export function HtmlIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d='M8 8l-4 4 4 4' />
      <path d='M16 8l4 4-4 4' />
      <line x1='14' y1='4' x2='10' y2='20' />
    </svg>
  )
}
