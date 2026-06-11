import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * Hand icon (Hugeicons stroke-rounded: Hold01Icon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function Hand({ size = 24, width, height, ...props }: IconProps) {
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
        d='M14 5.5C14 4.67157 14.6716 4 15.5 4C16.3284 4 17 4.67157 17 5.5V12M11.0002 10V5L11 3.5C11 2.67157 11.6716 2 12.5 2C13.3284 2 14 2.67157 14 3.5V5.5M14 5.5V11M11.0002 5C10.9999 4.17187 10.3284 3.50064 9.50021 3.50064C8.67178 3.50064 8.00021 4.17221 8.00021 5.00064L8 13.4624L6.3797 11.837C5.66877 11.1239 4.49772 11.1889 3.86965 11.9765C3.38907 12.5791 3.3758 13.4315 3.83738 14.0489L7.43707 18.6471C8.12579 19.5269 8.5 20.8829 8.5 22.0002M18 22.0002V20.8356C18 20.3038 18.2148 19.7964 18.5652 19.3964C18.9703 18.9339 19.4769 18.2939 19.6689 17.792C20 16.9269 20 15.8402 20 13.6668L20.0004 12.1943L20 7.5C20 6.67157 19.3284 6 18.5 6C17.6716 6 17 6.67157 17 7.5'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
