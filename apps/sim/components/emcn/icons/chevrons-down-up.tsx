import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * ChevronsDownUp icon (Hugeicons stroke-rounded: ChevronsDownUpIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function ChevronsDownUp({ size = 24, width, height, ...props }: IconProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={width ?? size}
      height={height ?? size}
      viewBox='0 0 24 24'
      fill='none'
      aria-hidden='true'
      {...props}
    >
      <path
        d='M7 19C7 19 10.6824 14 12 14C13.3176 14 17 19 17 19'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M7 5.00004C7 5.00004 10.6824 9.99999 12 10C13.3176 10 17 5 17 5'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
