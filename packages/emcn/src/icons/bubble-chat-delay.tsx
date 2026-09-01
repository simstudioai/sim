import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * BubbleChatDelay icon (Hugeicons stroke-rounded: BubbleChatDelayIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function BubbleChatDelay({ size = 24, width, height, ...props }: IconProps) {
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
        d='M21.5 12C21.5 17.25 17.25 21.5 12 21.5C10.37 21.5 8.84 21.09 7.5 20.37C5.63 19.36 4.37 20.3 3.27 20.47C3.1 20.49 2.93 20.43 2.81 20.31C2.63 20.13 2.59 19.85 2.69 19.61C3.13 18.58 3.53 16.64 2.98 15C2.67 14.06 2.5 13.05 2.5 12C2.5 6.75 6.75 2.5 12 2.5C17.25 2.5 21.5 6.75 21.5 12Z'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.55'
      />
      <path
        d='M12 7V12L15 14'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.55'
      />
    </svg>
  )
}
