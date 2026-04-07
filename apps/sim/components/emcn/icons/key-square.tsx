import type { SVGProps } from 'react'

/**
 * KeySquare icon component - key inside a rounded square
 * @param props - SVG properties including className, fill, etc.
 */
export function KeySquare(props: SVGProps<SVGSVGElement>) {
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
      aria-hidden='true'
      {...props}
    >
      <rect x='1.25' y='0.75' width='18' height='18' rx='2.5' />
      <circle cx='8.75' cy='9.25' r='2.5' />
      <path d='M10.75 7.75L14.25 7.75' />
      <path d='M14.25 7.75V10.25' />
      <path d='M12.25 7.75V9.75' />
    </svg>
  )
}
