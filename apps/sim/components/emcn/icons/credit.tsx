import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * Credit icon (Hugeicons stroke-rounded: CreditCardIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function Credit({ size = 24, width, height, ...props }: IconProps) {
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
        d='M2 12C2 8.46252 2 6.69377 3.0528 5.5129C3.22119 5.32403 3.40678 5.14935 3.60746 4.99087C4.86213 4 6.74142 4 10.5 4H13.5C17.2586 4 19.1379 4 20.3925 4.99087C20.5932 5.14935 20.7788 5.32403 20.9472 5.5129C22 6.69377 22 8.46252 22 12C22 15.5375 22 17.3062 20.9472 18.4871C20.7788 18.676 20.5932 18.8506 20.3925 19.0091C19.1379 20 17.2586 20 13.5 20H10.5C6.74142 20 4.86213 20 3.60746 19.0091C3.40678 18.8506 3.22119 18.676 3.0528 18.4871C2 17.3062 2 15.5375 2 12Z'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M10 16H11.5'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M14.5 16L18 16'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path d='M2 9H22' stroke='currentColor' strokeLinejoin='round' strokeWidth='1.5' />
    </svg>
  )
}
