import type { SVGProps } from 'react'

export function Hand(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path
        d='M6.5 11V6.5C6.5 5.67 7.17 5 8 5C8.83 5 9.5 5.67 9.5 6.5V11'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M9.5 10.5V5.5C9.5 4.67 10.17 4 11 4C11.83 4 12.5 4.67 12.5 5.5V10.5'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M12.5 10.5V6.5C12.5 5.67 13.17 5 14 5C14.83 5 15.5 5.67 15.5 6.5V10.5'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M15.5 10.5V8.5C15.5 7.67 16.17 7 17 7C17.83 7 18.5 7.67 18.5 8.5V15.5C18.5 18.81 15.81 21.5 12.5 21.5H11.5C8.19 21.5 5.5 18.81 5.5 15.5V13C5.5 12.17 6.17 11.5 7 11.5C7.83 11.5 8.5 12.17 8.5 13'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
