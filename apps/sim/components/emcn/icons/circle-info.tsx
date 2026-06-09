import type { SVGProps } from 'react'

/**
 * CircleInfo icon — a circled "i", used for the info intent. Named for its
 * shape to match its siblings (`CircleAlert`, `CircleCheck`) and to avoid
 * colliding with the `Info` component re-exported from the emcn barrel.
 * @param props - SVG properties including className, fill, etc.
 */
export function CircleInfo(props: SVGProps<SVGSVGElement>) {
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
      <path d='M12 16v-4' />
      <path d='M12 8h.01' />
    </svg>
  )
}
