import type { SVGProps } from 'react'

/**
 * LogIn icon component - arrow entering a door
 * @param props - SVG properties including className, fill, etc.
 */
export function LogIn(props: SVGProps<SVGSVGElement>) {
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
      <path d='M11.75 0.75H16.25C17.3546 0.75 18.25 1.64543 18.25 2.75V16.75C18.25 17.8546 17.3546 18.75 16.25 18.75H11.75' />
      <path d='M8.25 13.75L12.25 9.75L8.25 5.75' />
      <path d='M12.25 9.75H1.25' />
    </svg>
  )
}
