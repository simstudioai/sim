import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * Database icon (Hugeicons stroke-rounded: DatabaseIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function Database({ size = 24, width, height, ...props }: IconProps) {
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
      <ellipse cx='12' cy='5' rx='8' ry='3' stroke='currentColor' strokeWidth='1.5' />
      <path
        d='M7 10.842C7.60158 11.0229 8.27434 11.1718 9 11.282'
        stroke='currentColor'
        strokeLinecap='round'
        strokeWidth='1.5'
      />
      <path
        d='M20 12C20 13.6569 16.4183 15 12 15C7.58172 15 4 13.6569 4 12'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path
        d='M7 17.842C7.60158 18.0229 8.27434 18.1718 9 18.282'
        stroke='currentColor'
        strokeLinecap='round'
        strokeWidth='1.5'
      />
      <path
        d='M20 5V19C20 20.6569 16.4183 22 12 22C7.58172 22 4 20.6569 4 19V5'
        stroke='currentColor'
        strokeWidth='1.5'
      />
    </svg>
  )
}
