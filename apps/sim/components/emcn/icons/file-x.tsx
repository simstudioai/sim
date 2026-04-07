import type { SVGProps } from 'react'

/**
 * File-X icon component - document with an X mark indicating a missing or deleted file
 * @param props - SVG properties including className, fill, etc.
 */
export function FileX(props: SVGProps<SVGSVGElement>) {
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
      <path d='M3.25 12.5V2.75C3.25 1.64543 4.14543 0.75 5.25 0.75H12.25L17.25 5.75V16.75C17.25 17.8546 16.3546 18.75 15.25 18.75H9.5' />
      <path d='M12.25 0.75V5.75H17.25' />
      <path d='M3.25 15L7.25 19' />
      <path d='M7.25 15L3.25 19' />
    </svg>
  )
}
