import type { SVGProps } from 'react'

/**
 * CircleAlert icon component - circular alert used for error intent.
 * @param props - SVG properties including className, fill, etc.
 */
export function CircleAlert(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      {...props}
    >
      <circle cx='12' cy='12' r='10' />
      <path d='M12 8v4' />
      <path d='M12 16h.01' />
    </svg>
  )
}
