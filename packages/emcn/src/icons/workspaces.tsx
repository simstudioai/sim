import type { SVGProps } from 'react'

/**
 * Workspaces icon component - a stack of spaces: one rounded tile in front with
 * the top edges of two more receding behind it. Fills the same 19×18 footprint as
 * Table and Database (viewBox -1 -2 24 24, strokeWidth 1.55, round caps) with
 * their 2.5 corner radius, so it carries matching visual mass on the rail.
 * @param props - SVG properties including className, fill, etc.
 */
export function Workspaces(props: SVGProps<SVGSVGElement>) {
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
      <rect x='0.75' y='6.75' width='19' height='12' rx='2.5' />
      <path d='M3.75 3.75H16.75' />
      <path d='M6.75 0.75H13.75' />
    </svg>
  )
}
