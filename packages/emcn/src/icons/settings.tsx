import type { SVGProps } from 'react'

/**
 * Settings icon component - six-tooth gear with a hub
 * @param props - SVG properties including className, fill, etc.
 */
export function Settings(props: SVGProps<SVGSVGElement>) {
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
      <path d='M18.66 7.34A8.75 8.75 0 0 1 18.66 12.16L15.96 12.29A6.25 6.25 0 0 1 15.31 13.42L16.54 15.83A8.75 8.75 0 0 1 12.37 18.24L10.9 15.97A6.25 6.25 0 0 1 9.6 15.97L8.13 18.24A8.75 8.75 0 0 1 3.96 15.83L5.19 13.42A6.25 6.25 0 0 1 4.54 12.29L1.84 12.16A8.75 8.75 0 0 1 1.84 7.34L4.54 7.21A6.25 6.25 0 0 1 5.19 6.08L3.96 3.67A8.75 8.75 0 0 1 8.13 1.26L9.6 3.53A6.25 6.25 0 0 1 10.9 3.53L12.37 1.26A8.75 8.75 0 0 1 16.54 3.67L15.31 6.08A6.25 6.25 0 0 1 15.96 7.21Z' />
      <circle cx='10.25' cy='9.75' r='3' />
    </svg>
  )
}
