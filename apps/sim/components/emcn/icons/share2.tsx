import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * Share2 icon (Hugeicons stroke-rounded: Share08Icon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function Share2({ size = 24, width, height, ...props }: IconProps) {
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
        d='M21 6.5C21 8.15685 19.6569 9.5 18 9.5C16.3431 9.5 15 8.15685 15 6.5C15 4.84315 16.3431 3.5 18 3.5C19.6569 3.5 21 4.84315 21 6.5Z'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path
        d='M9 12C9 13.6569 7.65685 15 6 15C4.34315 15 3 13.6569 3 12C3 10.3431 4.34315 9 6 9C7.65685 9 9 10.3431 9 12Z'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path
        d='M21 17.5C21 19.1569 19.6569 20.5 18 20.5C16.3431 20.5 15 19.1569 15 17.5C15 15.8431 16.3431 14.5 18 14.5C19.6569 14.5 21 15.8431 21 17.5Z'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path
        d='M8.72852 10.7495L15.2285 7.75M8.72852 13.25L15.2285 16.2495'
        stroke='currentColor'
        strokeWidth='1.5'
      />
    </svg>
  )
}
