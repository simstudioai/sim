import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * Building2 icon (Hugeicons stroke-rounded: Building06Icon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function Building2({ size = 24, width, height, ...props }: IconProps) {
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
        d='M12 2H6C3.518 2 3 2.518 3 5V22H15V5C15 2.518 14.482 2 12 2Z'
        stroke='currentColor'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M18 8H15V22H21V11C21 8.518 20.482 8 18 8Z'
        stroke='currentColor'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M8 6L10 6M8 9L10 9M8 12L10 12'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M11.5 22V18C11.5 17.0572 11.5 16.5858 11.2071 16.2929C10.9142 16 10.4428 16 9.5 16H8.5C7.55719 16 7.08579 16 6.79289 16.2929C6.5 16.5858 6.5 17.0572 6.5 18V22'
        stroke='currentColor'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
