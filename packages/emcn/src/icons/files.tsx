import type { SVGProps } from 'react'

/**
 * Files icon component - stacked documents with folded corner on the front doc
 * @param props - SVG properties including className, fill, etc.
 */
export function Files(props: SVGProps<SVGSVGElement>) {
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
      <path d='M11.25 1.75H4.25C3.14543 1.75 2.25 2.64543 2.25 3.75V14.75' />
      <path d='M14.25 4.75H7.25C6.14543 4.75 5.25 5.64543 5.25 6.75V17.75C5.25 18.8546 6.14543 19.75 7.25 19.75H17.25C18.3546 19.75 19.25 18.8546 19.25 17.75V9.75L14.25 4.75Z' />
      <path d='M14.25 4.75V9.75H19.25' />
    </svg>
  )
}
