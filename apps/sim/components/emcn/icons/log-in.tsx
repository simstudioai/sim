import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * LogIn icon (Hugeicons stroke-rounded: Login03Icon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function LogIn({ size = 24, width, height, ...props }: IconProps) {
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
        d='M6 18C6 18.4644 6 18.6965 6.022 18.8918C6.20482 20.5145 7.48545 21.7952 9.10814 21.978C9.30345 22 9.53562 22 9.99998 22H13C16.2998 22 17.9497 22 18.9749 20.9749C20 19.9498 20 18.2998 20 15L20 8.99998C20 5.70016 20 4.05024 18.9748 3.02512C17.9497 2 16.2998 2 13 2H9.99998C9.53563 2 9.30345 2 9.10814 2.02201C7.48545 2.20483 6.20482 3.48547 6.022 5.10816C6 5.30347 6 5.53565 6 6'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M4.07612 11.1183C4 11.3021 4 11.535 4 12.001C4 12.4669 4 12.6999 4.07612 12.8837C4.17761 13.1287 4.37229 13.3234 4.61732 13.4249C4.80109 13.501 5.03406 13.501 5.5 13.501H10.5C10.5002 15.2503 10.511 16.1299 11.0623 16.3858C11.0829 16.3954 11.1037 16.4042 11.1249 16.4124C11.7045 16.6353 12.3999 16.0139 13.7907 14.7711C15.2576 13.4602 15.9912 12.7851 16 11.957C15.9912 11.1289 15.2576 10.4538 13.7907 9.14301C12.3999 7.90018 11.7045 7.27876 11.1249 7.50171C11.1037 7.50985 11.0829 7.51869 11.0623 7.52822C10.5018 7.78844 10.5 8.69318 10.5 10.501H5.5C5.03406 10.501 4.80109 10.501 4.61732 10.5771C4.37229 10.6786 4.17761 10.8733 4.07612 11.1183Z'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
