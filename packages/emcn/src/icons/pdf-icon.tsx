import type { SVGProps } from 'react'

/** PDF icon. Callers provide size and color through SVG props. */
export function PdfIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
      <rect x='4' y='2' width='16' height='20' rx='2' stroke='currentColor' strokeWidth='1.5' />
      <text
        x='12'
        y='12'
        textAnchor='middle'
        dominantBaseline='central'
        fontSize='5.5'
        fontWeight='bold'
        fontFamily='Arial, sans-serif'
        letterSpacing='0.5'
        fill='currentColor'
      >
        PDF
      </text>
    </svg>
  )
}
