import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * TypeNumber icon (Hugeicons stroke-rounded: TextNumberSignIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function TypeNumber({ size = 24, width, height, ...props }: IconProps) {
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
        d='M2 20V7.02172C2 5.10465 2 4.00007 2.4389 4.00007C2.95995 4.00007 3.33531 4.66033 4.25033 6.27292L10.7497 17.7271C11.6647 19.3397 12.0233 20 12.5611 20C13 20 13 18.8954 13 16.9784V4'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M16 13L22 13'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M16.5806 4.58081C17.3546 3.80672 20.6454 3.80672 21.4194 4.58081C22.1935 5.35489 22.1935 8.6456 21.4194 9.41968C20.6454 10.1938 17.3546 10.1938 16.5806 9.41968C15.8065 8.6456 15.8065 5.35489 16.5806 4.58081Z'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
