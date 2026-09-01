import type { SVGProps } from 'react'

/**
 * MicOff icon component - microphone with diagonal strike-through for the muted state
 * @param props - SVG properties including className, fill, etc.
 */
export function MicOff(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1 -2 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <rect x='7.25' y='1.25' width='6' height='11.5' rx='3' />
      <path d='M3.75 9.25V9.75C3.75 13.34 6.66 16.25 10.25 16.25C13.84 16.25 16.75 13.34 16.75 9.75V9.25' />
      <path d='M10.25 16.25V18.25' />
      <path d='M3.25 2.75L17.25 16.75' />
    </svg>
  )
}
