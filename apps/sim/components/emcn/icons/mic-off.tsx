import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * MicOff icon (Hugeicons stroke-rounded: MicOff01Icon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function MicOff({ size = 24, width, height, ...props }: IconProps) {
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
      <path d='M2 2L22 22' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      <path
        d='M4 11C4 15.4183 7.58172 19 12 19M12 19C13.9545 19 15.7454 18.2991 17.1348 17.1348M12 19V22M12 22H15M12 22H9M20 11C20 12.6514 19.4996 14.1859 18.6422 15.4603'
        stroke='currentColor'
        strokeLinecap='round'
        strokeWidth='1.5'
      />
      <path
        d='M17.0078 6.99599C17.0078 4.23457 14.7692 2.01599 12.0078 2.01599C10.139 2.01599 8.5379 2.98126 7.67981 4.49999M17.0078 6.99599L13.9798 7.00799M17.0078 6.99599V11.004M7.00781 6.99599V11.016C7.00781 13.7774 9.24639 16.016 12.0078 16.016C13.1432 16.016 14.1725 15.6256 15.0118 14.988M16.4465 13.26C16.8051 12.5705 17.0078 11.8469 17.0078 11.016V11.004M14.1829 11.004H17.0078'
        stroke='currentColor'
        strokeLinecap='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
