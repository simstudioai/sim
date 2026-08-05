import type { SVGProps } from 'react'

/**
 * TextQuote icon component - two full lines above two indented lines marked by a quote bar
 * @param props - SVG properties including className, fill, etc.
 */
export function TextQuote(props: SVGProps<SVGSVGElement>) {
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
      <path d='M1.6 2.4H19M1.6 6.9H19M6 11.4H19M6 15.9H19' />
      <path d='M1.6 10.2V17.1' />
    </svg>
  )
}
