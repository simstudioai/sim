import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

/**
 * Card icon (Hugeicons stroke-rounded: Cards01Icon)
 * @param props - SVG properties including className, size, fill, etc.
 */
export function Card({ size = 24, width, height, ...props }: IconProps) {
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
        d='M3 11C3 8.17157 3 6.75736 3.87868 5.87868C4.75736 5 6.17157 5 9 5H11C13.8284 5 15.2426 5 16.1213 5.87868C17 6.75736 17 8.17157 17 11V16C17 18.8284 17 20.2426 16.1213 21.1213C15.2426 22 13.8284 22 11 22H9C6.17157 22 4.75736 22 3.87868 21.1213C3 20.2426 3 18.8284 3 16V11Z'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path
        d='M8.04435 11.762L8.42742 11.3048C9.15621 10.4349 9.52061 10 10 10C10.4794 10 10.8438 10.4349 11.5726 11.3048L11.9556 11.762C12.6519 12.593 13 13.0086 13 13.5C13 13.9914 12.6519 14.407 11.9556 15.238L11.5726 15.6952C10.8438 16.5651 10.4794 17 10 17C9.52061 17 9.15621 16.5651 8.42742 15.6952L8.04435 15.238C7.34812 14.407 7 13.9914 7 13.5C7 13.0086 7.34812 12.593 8.04435 11.762Z'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path
        d='M16.9244 19C18.0202 18.3874 18.3929 17.0406 19.1383 14.3469L20.1925 10.5375C20.938 7.84378 21.3107 6.49694 20.678 5.4359C20.0453 4.37485 18.6543 4.01397 15.8724 3.2922L13.9052 2.78183C11.1232 2.06006 9.73225 1.69918 8.63642 2.31177C7.85623 2.74792 7.44258 3.55626 7 4.95786'
        stroke='currentColor'
        strokeWidth='1.5'
      />
    </svg>
  )
}
