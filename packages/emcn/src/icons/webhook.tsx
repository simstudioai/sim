import type { SVGProps } from 'react'

/**
 * Webhook icon component - three arcs radiating from a shared centre into node dots
 * @param props - SVG properties including className, fill, etc.
 */
export function Webhook(props: SVGProps<SVGSVGElement>) {
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
      <path d='M10.25 11.55C7.98 9.62 7.98 7.68 10.25 5.75M10.25 11.55C13.06 10.55 14.73 11.52 15.27 14.45M10.25 11.55C9.71 14.48 8.03 15.45 5.23 14.45' />
      <circle cx='10.25' cy='4.35' r='1.4' />
      <circle cx='16.49' cy='15.15' r='1.4' />
      <circle cx='4.01' cy='15.15' r='1.4' />
    </svg>
  )
}
