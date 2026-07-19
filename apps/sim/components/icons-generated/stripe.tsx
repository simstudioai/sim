import type { SVGProps } from 'react'

/**
 * Stripe icon component.
 * TODO: Replace with actual SVG from the service's brand kit.
 */
export function StripeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <rect width='24' height='24' rx='4' fill='currentColor' opacity='0.15' />
      <text x='12' y='16' textAnchor='middle' fontSize='12' fontWeight='bold' fill='currentColor'>
        ST
      </text>
    </svg>
  )
}
