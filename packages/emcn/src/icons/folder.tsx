import type { SVGProps } from 'react'

/**
 * Folder icon component - closed counterpart of {@link FolderOpen}
 *
 * The path is FolderOpen's own body outline, closed along the bottom-right, so
 * the pair shares a silhouette, a box and a stroke weight. The two toggle in
 * place (sidebar folder rows), which makes any divergence read as the icon
 * changing size on expand.
 *
 * The outline is drawn to the same optical extent as the sibling list icons
 * ({@link Table}, {@link Database}) — ~17 units tall inside the shared
 * `-1 -2 24 24` box. Drawn smaller it reads as a smaller icon in a resource
 * row even at an identical `size-*` class, since the class sets the box, not
 * the artwork. Any change here must be mirrored in {@link FolderOpen} and
 * {@link FolderCode}, which reuse this outline verbatim.
 *
 * @param props - SVG properties including className, fill, etc.
 */
export function Folder(props: SVGProps<SVGSVGElement>) {
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
    </svg>
  )
}
