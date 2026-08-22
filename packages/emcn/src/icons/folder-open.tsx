import type { SVGProps } from 'react'

/**
 * FolderOpen icon component - folder with its front panel tilted open
 *
 * The body outline is {@link Folder}'s path verbatim up to the flap join, so
 * the pair toggles in place without shifting. Keep the two in lockstep.
 *
 * @param props - SVG properties including className, fill, etc.
 */
export function FolderOpen(props: SVGProps<SVGSVGElement>) {
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
      <path d='M3 18.25A2.25 2.25 0 0 1 0.75 16V3.5A2.25 2.25 0 0 1 3 1.25H6.5L9.5 4.75H15A2.25 2.25 0 0 1 17.25 7V9.25' />
      <path d='M5.75 9.25H19.75L17 18.25H3Z' />
    </svg>
  )
}
