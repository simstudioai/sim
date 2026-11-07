import type { SVGProps } from 'react'

/** Spreadsheet icon. Callers provide size and color through SVG props. */
export function XlsxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
      <rect x='3' y='3' width='18' height='18' rx='2' stroke='currentColor' strokeWidth='1.5' />
      <line x1='3' y1='9' x2='21' y2='9' stroke='currentColor' strokeWidth='1.5' />
      <line x1='3' y1='15' x2='21' y2='15' stroke='currentColor' strokeWidth='1.5' />
      <line x1='9' y1='3' x2='9' y2='21' stroke='currentColor' strokeWidth='1.5' />
      <line x1='15' y1='3' x2='15' y2='21' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  )
}
