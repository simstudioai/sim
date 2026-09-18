import type { SVGProps } from 'react'

/** Markdown icon. Callers provide size and color through SVG props. */
export function MarkdownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
      <rect x='2' y='4' width='20' height='16' rx='3' stroke='currentColor' strokeWidth='1.5' />
      <path
        d='M6 15V9l3 3.5L12 9v6'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M17 9v6m-2-2l2 2 2-2'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
