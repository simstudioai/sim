import type { SVGProps } from 'react'

/**
 * File icon component - single document with folded corner
 * @param props - SVG properties including className, fill, etc.
 */
export function File(props: SVGProps<SVGSVGElement>) {
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
      <path d='M12.25 0.75H5.25C4.14543 0.75 3.25 1.64543 3.25 2.75V16.75C3.25 17.8546 4.14543 18.75 5.25 18.75H15.25C16.3546 18.75 17.25 17.8546 17.25 16.75V5.75L12.25 0.75Z' />
      <path d='M12.25 0.75V5.75H17.25' />
    </svg>
  )
}
