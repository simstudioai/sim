import type { SVGProps } from 'react'

/**
 * FormInput icon component - input field with a text caret and placeholder dashes
 * @param props - SVG properties including className, fill, etc.
 */
export function FormInput(props: SVGProps<SVGSVGElement>) {
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
      <rect x='1.25' y='3.75' width='18' height='12' rx='2' />
      <path d='M4.75 6.75V12.75' />
      <path d='M8.25 9.75H11M13 9.75H15.75' />
    </svg>
  )
}
