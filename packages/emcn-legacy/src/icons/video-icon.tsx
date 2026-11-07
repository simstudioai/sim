import type { SVGProps } from 'react'

/** Video icon. Callers provide size and color through SVG props. */
export function VideoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
      <rect x='2' y='4' width='20' height='16' rx='2' stroke='currentColor' strokeWidth='1.5' />
      <path d='M10 9l5 3-5 3V9Z' fill='currentColor' />
    </svg>
  )
}
