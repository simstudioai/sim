import type { SVGProps } from 'react'

/**
 * Type url icon component - chain link for url columns
 * @param props - SVG properties including className, fill, etc.
 */
export function TypeUrl(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1.75 -1.5 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M8.5 12.25C9.15 13.1 10.15 13.6 11.25 13.6C12.15 13.6 13 13.25 13.65 12.6L16.65 9.6C18 8.25 18 6.05 16.65 4.7C15.3 3.35 13.1 3.35 11.75 4.7L10.5 5.95' />
      <path d='M12 8.75C11.35 7.9 10.35 7.4 9.25 7.4C8.35 7.4 7.5 7.75 6.85 8.4L3.85 11.4C2.5 12.75 2.5 14.95 3.85 16.3C5.2 17.65 7.4 17.65 8.75 16.3L10 15.05' />
    </svg>
  )
}
