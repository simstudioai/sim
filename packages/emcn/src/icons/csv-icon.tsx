import type { SVGProps } from 'react'

/** CSV icon. Callers provide size and color through SVG props. */
export function CsvIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
      <rect x='3' y='1' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <rect x='13' y='1' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <rect x='3' y='9' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <rect x='13' y='9' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <rect x='3' y='17' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <rect x='13' y='17' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  )
}
