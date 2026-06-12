import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * ClipboardList icon (Hugeicons stroke-rounded: ClipboardListIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function ClipboardList({ size = 24, width, height, ...props }: IconProps) {
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
        d='M12 11H16'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M12 16H16'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M8 11H8.01'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M8 16H8.01'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M14.5 2H9.5C8.67157 2 8 2.67157 8 3.5C8 4.32843 8.67157 5 9.5 5H14.5C15.3284 5 16 4.32843 16 3.5C16 2.67157 15.3284 2 14.5 2Z'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M16 3.5C17.5535 3.54681 18.48 3.72007 19.1213 4.36137C20 5.24004 20 6.65424 20 9.48263L20 15.9995C20 18.8279 20 20.2421 19.1213 21.1208C18.2426 21.9995 16.8284 21.9995 14 21.9995L10 21.9995C7.17158 21.9995 5.75737 21.9995 4.87869 21.1208C4.00001 20.2421 4.00001 18.8279 4 15.9995L4.00001 9.48269C4.00001 6.65425 4 5.24004 4.87868 4.36136C5.51997 3.72007 6.44651 3.54681 7.9999 3.5'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
