import type { SVGProps } from 'react'

export function Hand(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path
        d='M6.5 11V6.5C6.5 5.67157 7.17157 5 8 5C8.82843 5 9.5 5.67157 9.5 6.5V11'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M9.5 10.5V5.5C9.5 4.67157 10.1716 4 11 4C11.8284 4 12.5 4.67157 12.5 5.5V10.5'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M12.5 10.5V6.5C12.5 5.67157 13.1716 5 14 5C14.8284 5 15.5 5.67157 15.5 6.5V10.5'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M15.5 10.5V8.5C15.5 7.67157 16.1716 7 17 7C17.8284 7 18.5 7.67157 18.5 8.5V15.5C18.5 18.8137 15.8137 21.5 12.5 21.5H11.5C8.18629 21.5 5.5 18.8137 5.5 15.5V13C5.5 12.1716 6.17157 11.5 7 11.5C7.82843 11.5 8.5 12.1716 8.5 13'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
