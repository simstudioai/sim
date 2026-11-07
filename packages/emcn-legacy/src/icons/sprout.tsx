import type { SVGProps } from 'react'

/**
 * Sprout icon component - a seedling with two leaves
 * @param props - SVG properties including className, fill, etc.
 */
export function Sprout(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M12 20.5V11' />
      <path d='M12 14.75Q4.94 15.12 3.5 8.2Q10.56 7.83 12 14.75Z' />
      <path d='M12 11.25Q19.06 11.62 20.5 4.7Q13.44 4.33 12 11.25Z' />
    </svg>
  )
}
