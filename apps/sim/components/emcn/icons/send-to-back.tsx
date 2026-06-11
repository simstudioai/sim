import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * SendToBack icon (Hugeicons stroke-rounded: LayerSendToBackIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function SendToBack({ size = 24, width, height, ...props }: IconProps) {
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
        d='M12 21.5V7M15 19C14.4102 19.6068 12.8403 22 12 22C11.1597 22 9.58984 19.6068 9 19'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M20.2327 11.5C21.4109 12.062 22 12.4405 22 13.0001C22 13.6934 21.0958 14.1087 19.2873 14.9395L15.8901 16.5M3.76727 11.5C2.58909 12.062 2 12.4405 2 13.0001C2 13.6934 2.90423 14.1087 4.7127 14.9395L8.1099 16.5'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M8.11012 10.5L4.7127 8.93936C2.90423 8.10863 2 7.69326 2 7C2 6.30674 2.90423 5.89137 4.7127 5.06064L9.60573 2.81298C10.7856 2.27099 11.3755 2 12 2C12.6245 2 13.2144 2.27099 14.3943 2.81298L19.2873 5.06064C21.0958 5.89137 22 6.30674 22 7C22 7.69326 21.0958 8.10863 19.2873 8.93937L15.8899 10.5'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
