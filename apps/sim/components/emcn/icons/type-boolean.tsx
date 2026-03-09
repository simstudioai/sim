import type { SVGProps } from 'react'

/**
 * Type boolean icon component - toggle switch for boolean columns
 * @param props - SVG properties including className, fill, etc.
 */
export function TypeBoolean(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1 -2 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <rect x='1.25' y='5.25' width='18' height='10.5' rx='5.25' />
      <circle cx='6.5' cy='10.5' r='3' />
    </svg>
  )
}
