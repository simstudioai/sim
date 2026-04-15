import type { SVGProps } from 'react'

/**
 * Play icon component (filled/solid version)
 * @param props - SVG properties including className, fill, etc.
 */
export function Play(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='10'
      height='10'
      viewBox='0 0 10 10'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path
        d='M6.13231 1.69656C7.08485 2.23771 7.83339 2.66296 8.36666 3.0525C8.9036 3.44472 9.30069 3.85468 9.44293 4.39515C9.54724 4.79151 9.54724 5.20844 9.44293 5.6048C9.30069 6.14527 8.9036 6.55523 8.36666 6.94744C7.8334 7.33698 7.08487 7.76223 6.13234 8.30337L6.13233 8.30338L6.13231 8.30339C5.21218 8.82615 4.43625 9.26697 3.8472 9.51751C3.25341 9.77007 2.71208 9.89808 2.18595 9.74899C1.7993 9.63942 1.44748 9.43146 1.16407 9.14552C0.779435 8.75745 0.62504 8.22109 0.551993 7.5756C0.479482 6.93484 0.479486 6.09605 0.479492 5.0292V5.0292V4.97075V4.97075C0.479486 3.9039 0.479482 3.06511 0.551993 2.42435C0.62504 1.77886 0.779435 1.2425 1.16407 0.85443C1.44748 0.568491 1.7993 0.360528 2.18595 0.250961C2.71208 0.10187 3.25341 0.229878 3.8472 0.482438C4.43626 0.732984 5.21217 1.1738 6.13231 1.69656L6.13231 1.69656Z'
        fill='currentColor'
      />
    </svg>
  )
}

/**
 * Play icon component (stroke/outline version)
 * @param props - SVG properties including className, stroke, etc.
 */
export function PlayOutline(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M14.26 5.39C16.17 6.48 17.67 7.33 18.73 8.11C19.81 8.89 20.6 9.71 20.89 10.79C21.09 11.58 21.09 12.42 20.89 13.21C20.6 14.29 19.81 15.11 18.73 15.89C17.67 16.67 16.17 17.52 14.26 18.61C12.42 19.65 10.87 20.53 9.69 21.04C8.51 21.54 7.42 21.8 6.37 21.5C5.6 21.28 4.89 20.86 4.33 20.29C3.56 19.51 3.25 18.44 3.1 17.15C2.96 15.87 2.96 14.19 2.96 12.06V11.94C2.96 9.81 2.96 8.13 3.1 6.85C3.25 5.56 3.56 4.49 4.33 3.71C4.89 3.14 5.6 2.72 6.37 2.5C7.42 2.2 8.51 2.46 9.69 2.96C10.87 3.47 12.42 4.35 14.26 5.39Z' />
    </svg>
  )
}
