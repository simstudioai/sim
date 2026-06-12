import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * Plus icon (Hugeicons stroke-rounded: Add01Icon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function Plus({ size = 24, width, height, ...props }: IconProps) {
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
        d='M12.001 5.00003V19.002'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M19.002 12.002L4.99998 12.002'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
