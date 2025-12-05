import type { SVGProps } from 'react'

/**
 * HexSimple icon component - regular hexagon with centered circle
 * @param props - SVG properties including className, fill, etc.
 */
export function HexSimple(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path
        d='M12 2L20.66 7V17L12 22L3.34 17V7L12 2Z'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinejoin='round'
      />
      <circle cx='12' cy='12' r='4' fill='none' stroke='currentColor' strokeWidth='2' />
    </svg>
  )
}
