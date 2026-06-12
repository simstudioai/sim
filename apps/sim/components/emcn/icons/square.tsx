import type { SVGProps } from 'react'

/**
 * Square icon (stroke/outline version) — used as the "stop" glyph in
 * media-control-style buttons (per-row run/stop, table action bar, context
 * menus). Same visual as `lucide-react`'s `Square` so existing call sites
 * migrate without any visual change.
 */
export function Square(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <rect x='3' y='3' width='18' height='18' rx='2' />
    </svg>
  )
}
