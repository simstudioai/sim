import type { SVGProps } from 'react'

/**
 * FormInput icon component - displays a labeled input field with a cursor
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
      <path d='M0.75 2.25H9.25' />
      <rect x='0.75' y='6.25' width='19' height='8' rx='1' />
      <path d='M4.75 8.75V11.75' />
      <path d='M0.75 18.25H12.75' />
    </svg>
  )
}
