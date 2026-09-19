import type { SVGProps } from 'react'

/** Chart icon. Callers provide size and color through SVG props. */
export function ChartFileIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d='M3 3v17a1 1 0 0 0 1 1h17' />
      <rect x='7' y='12' width='3' height='6' rx='0.5' />
      <rect x='12.5' y='8' width='3' height='10' rx='0.5' />
      <rect x='18' y='5' width='3' height='13' rx='0.5' />
    </svg>
  )
}
