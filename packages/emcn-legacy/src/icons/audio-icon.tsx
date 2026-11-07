import type { SVGProps } from 'react'

/** Audio icon. Callers provide size and color through SVG props. */
export function AudioIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <line x1='4' y1='14' x2='4' y2='10' />
      <line x1='8' y1='17' x2='8' y2='7' />
      <line x1='12' y1='15' x2='12' y2='9' />
      <line x1='16' y1='18' x2='16' y2='6' />
      <line x1='20' y1='14' x2='20' y2='10' />
    </svg>
  )
}
