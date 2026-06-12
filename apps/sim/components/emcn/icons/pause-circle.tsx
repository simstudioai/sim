import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * PauseCircle icon (Hugeicons stroke-rounded: PauseCircleIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function PauseCircle({ size = 24, width, height, ...props }: IconProps) {
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
      <circle cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='1.5' />
      <path
        d='M9.5 9L9.5 15M14.5 9V15'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
