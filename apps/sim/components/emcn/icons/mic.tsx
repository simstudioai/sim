import type { SVGProps } from 'react'

/**
 * Mic icon component - microphone with stand for voice input
 * @param props - SVG properties including className, fill, etc.
 */
export function Mic(props: SVGProps<SVGSVGElement>) {
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
      <rect x='7.25' y='0.75' width='6' height='12' rx='3' />
      <path d='M3.75 9.25V10.25C3.75 13.8399 6.66015 16.75 10.25 16.75C13.8399 16.75 16.75 13.8399 16.75 10.25V9.25' />
      <path d='M10.25 16.75V19.25' />
    </svg>
  )
}
