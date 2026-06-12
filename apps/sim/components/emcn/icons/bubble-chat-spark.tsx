import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * BubbleChatSpark icon (Hugeicons stroke-rounded: BubbleChatSparkIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function BubbleChatSpark({ size = 24, width, height, ...props }: IconProps) {
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
        d='M21.5 12C21.5 17.2467 17.2467 21.5 12 21.5C10.3719 21.5 8.8394 21.0904 7.5 20.3687C5.63177 19.362 4.37462 20.2979 3.26592 20.4658C3.09774 20.4913 2.93024 20.4302 2.80997 20.31C2.62741 20.1274 2.59266 19.8451 2.6935 19.6074C3.12865 18.5818 3.5282 16.6382 2.98341 15C2.6698 14.057 2.5 13.0483 2.5 12C2.5 6.75329 6.75329 2.5 12 2.5C17.2467 2.5 21.5 6.75329 21.5 12Z'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M11.9649 8.02864C11.9727 7.99045 12.0273 7.99045 12.0351 8.02864C12.4402 10.0108 13.9892 11.5598 15.9714 11.9649C16.0095 11.9727 16.0095 12.0273 15.9714 12.0351C13.9892 12.4402 12.4402 13.9892 12.0351 15.9714C12.0273 16.0095 11.9727 16.0095 11.9649 15.9714C11.5598 13.9892 10.0108 12.4402 8.02864 12.0351C7.99045 12.0273 7.99045 11.9727 8.02864 11.9649C10.0108 11.5598 11.5598 10.0108 11.9649 8.02864Z'
        stroke='currentColor'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
