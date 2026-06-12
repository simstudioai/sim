import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * GitBranch icon (Hugeicons stroke-rounded: GitBranchIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function GitBranch({ size = 24, width, height, ...props }: IconProps) {
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
        d='M7 19H13C15.8284 19 17.2426 19 18.1213 18.1213C19 17.2426 19 15.8284 19 13V10M19 10C19.7002 10 21.0085 11.9943 21.5 12.5M19 10C18.2998 10 16.9915 11.9943 16.5 12.5'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M5 7L5 17'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <circle cx='5' cy='5' r='2' stroke='currentColor' strokeWidth='1.5' />
      <circle cx='19' cy='5' r='2' stroke='currentColor' strokeWidth='1.5' />
      <circle cx='5' cy='19' r='2' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  )
}
