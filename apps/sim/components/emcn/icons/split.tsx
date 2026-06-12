import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * Split icon (Hugeicons stroke-rounded: SplitIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function Split({ size = 24, width, height, ...props }: IconProps) {
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
        d='M21 8.5V6.6C21 4.90294 21 4.05442 20.4728 3.52721C19.9456 3 19.0971 3 17.4 3H15.5M20 4L14.5 9.5'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M3 8.5V6.6C3 4.90294 3 4.05442 3.52721 3.52721C4.05442 3 4.90294 3 6.6 3H8.5M4 4L9.65686 9.65686C10.813 10.813 11.391 11.391 11.6955 12.1261C12 12.8612 12 13.6787 12 15.3137V21'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
