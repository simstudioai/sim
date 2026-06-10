import type { SVGProps } from 'react'

/**
 * Slash icon component - forward slash "/" glyph for the skills trigger.
 * Matches the weight and optical box of Plus/Paperclip (viewBox -1 -2 24 24,
 * strokeWidth 1.55, round caps). Centered at (10.25, 10.25) like Plus.
 * @param props - SVG properties including className, fill, etc.
 */
export function Slash(props: SVGProps<SVGSVGElement>) {
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
      <path d='M14 3L6.5 17.5' />
    </svg>
  )
}
