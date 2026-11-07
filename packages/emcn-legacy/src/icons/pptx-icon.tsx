import type { SVGProps } from 'react'

/** Presentation icon. Callers provide size and color through SVG props. */
export function PptxIcon(props: SVGProps<SVGSVGElement>) {
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
      <rect x='2' y='4' width='20' height='16' rx='2' />
      <line x1='6' y1='9' x2='18' y2='9' />
      <line x1='8' y1='14' x2='16' y2='14' />
    </svg>
  )
}
