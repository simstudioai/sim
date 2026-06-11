import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * Hammer icon (Hugeicons stroke-rounded: HammerIcon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function Hammer({ size = 24, width, height, ...props }: IconProps) {
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
        d='M17.0794 6.53297L15.4953 4.94738C14.2496 3.70049 12.5601 3 10.7985 3C9.95308 3 9.52971 4.02309 10.1275 4.62145L10.5245 5.01883C11.9169 6.41256 11.9169 8.67222 10.5245 10.0659L13.0456 12.5895L14.5583 11.0754L16.0709 12.5895C15.514 13.147 15.514 14.0508 16.0709 14.6083L16.5752 15.113C16.9876 15.5258 17.1938 15.7322 17.4162 15.8426C17.8394 16.0525 18.3363 16.0525 18.7595 15.8426C18.9819 15.7322 19.1881 15.5258 19.6005 15.113L21.1132 13.5989C21.5256 13.1861 21.7318 12.9797 21.842 12.7571C22.0517 12.3335 22.0517 11.8361 21.842 11.4125C21.7318 11.1898 21.5256 10.9834 21.1132 10.5706L20.6089 10.0659C20.052 9.50845 19.149 9.50845 18.592 10.0659L17.0794 8.55181C17.6363 7.99432 17.6363 7.09046 17.0794 6.53297Z'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
      <path
        d='M10.6074 10L2.52431 17.9822C2.1886 18.3138 2 18.7634 2 19.2322C2 20.2085 2.80146 21 3.7901 21C4.26487 21 4.72019 20.8138 5.0559 20.4822L13.6453 12'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.5'
      />
    </svg>
  )
}
