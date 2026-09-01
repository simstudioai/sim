import type { SVGProps } from 'react'

/**
 * FolderCode icon component - a {@link Folder} carrying code brackets
 *
 * Shares {@link Folder}'s body path verbatim so the folder family reads as one
 * silhouette at one weight. The brackets are centred on the body (x 9, y 11.5)
 * rather than on the viewBox, so they sit inside the folder rather than
 * drifting toward the flap.
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
      <path d='M3 18.25A2.25 2.25 0 0 1 0.75 16V3.5A2.25 2.25 0 0 1 3 1.25H6.5L9.5 4.75H15A2.25 2.25 0 0 1 17.25 7V16A2.25 2.25 0 0 1 15 18.25Z' />
      <path d='M7.5 9.5L5.5 11.5L7.5 13.5' />
      <path d='M10.5 9.5L12.5 11.5L10.5 13.5' />
    </svg>
  )
}
