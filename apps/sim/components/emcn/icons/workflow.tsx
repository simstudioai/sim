import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * Workflow icon (Hugeicons stroke-rounded: WorkflowSquare08Icon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function Workflow({ size = 24, width, height, ...props }: IconProps) {
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
        d='M3 19C3 20.4142 3 21.1213 3.43934 21.5607C3.87868 22 4.58579 22 6 22C7.41421 22 8.12132 22 8.56066 21.5607C9 21.1213 9 20.4142 9 19C9 17.5858 9 16.8787 8.56066 16.4393C8.12132 16 7.41421 16 6 16C4.58579 16 3.87868 16 3.43934 16.4393C3 16.8787 3 17.5858 3 19Z'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path
        d='M3 5C3 6.41421 3 7.12132 3.43934 7.56066C3.87868 8 4.58579 8 6 8C7.41421 8 8.12132 8 8.56066 7.56066C9 7.12132 9 6.41421 9 5C9 3.58579 9 2.87868 8.56066 2.43934C8.12132 2 7.41421 2 6 2C4.58579 2 3.87868 2 3.43934 2.43934C3 2.87868 3 3.58579 3 5Z'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path
        d='M15 14C15 15.4142 15 16.1213 15.4393 16.5607C15.8787 17 16.5858 17 18 17C19.4142 17 20.1213 17 20.5607 16.5607C21 16.1213 21 15.4142 21 14C21 12.5858 21 11.8787 20.5607 11.4393C20.1213 11 19.4142 11 18 11C16.5858 11 15.8787 11 15.4393 11.4393C15 11.8787 15 12.5858 15 14Z'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path
        d='M6 8V16'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M15 14H12C8.68629 14 6 11.3137 6 8'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
