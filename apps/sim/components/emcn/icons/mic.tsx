import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * Mic icon (Hugeicons stroke-rounded: Mic01Icon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function Mic({ size = 24, width, height, ...props }: IconProps) {
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
        d='M17 7V11C17 13.7614 14.7614 16 12 16C9.23858 16 7 13.7614 7 11V7C7 4.23858 9.23858 2 12 2C14.7614 2 17 4.23858 17 7Z'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path d='M17 7H14M17 11H14' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      <path
        d='M20 11C20 15.4183 16.4183 19 12 19M12 19C7.58172 19 4 15.4183 4 11M12 19V22M12 22H15M12 22H9'
        stroke='currentColor'
        strokeLinecap='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
