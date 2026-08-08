import type { SVGProps } from 'react'

/**
 * FolderCode icon component - a {@link Folder} carrying code brackets
 *
 * Shares {@link Folder}'s body path verbatim so the folder family reads as one
 * silhouette at one weight. The brackets are centred on the body (x 9.125,
 * y 11.25) rather than on the viewBox, so they sit inside the folder rather
 * than drifting toward the flap.
 *
 * @param props - SVG properties including className, fill, etc.
 */
export function FolderCode(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1 -2 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M3.75 17.25A2 2 0 0 1 1.75 15.25V4.25A2 2 0 0 1 3.75 2.25H7L9.5 5.25H14.5A2 2 0 0 1 16.5 7.25V15.25A2 2 0 0 1 14.5 17.25Z' />
      <path d='M7.75 9.5L6 11.25L7.75 13' />
      <path d='M10.5 9.5L12.25 11.25L10.5 13' />
    </svg>
  )
}
