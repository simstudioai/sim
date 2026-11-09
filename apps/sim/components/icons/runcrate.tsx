import type { SVGProps } from 'react'

interface RuncrateIconProps extends SVGProps<SVGSVGElement> {}

/** Runcrate logo mark; accepts standard SVG props. */
export function RuncrateIcon(props: RuncrateIconProps) {
  return (
    <svg {...props} viewBox='0 0 64 64' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <rect width='64' height='64' rx='14' fill='#1C2E7F' />
      <path
        d='M18 20l14 12-14 12'
        stroke='#5B8CFF'
        strokeWidth='5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path d='M36 46h12' stroke='#5B8CFF' strokeWidth='5' strokeLinecap='round' />
    </svg>
  )
}
