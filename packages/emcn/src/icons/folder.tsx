import type { SVGProps } from 'react'

/**
 * Folder icon component - closed counterpart of {@link FolderOpen}
 *
 * The path is FolderOpen's own body outline, closed along the bottom-right, so
 * the pair shares a silhouette, a box and a stroke weight. The two toggle in
 * place (sidebar folder rows), which makes any divergence read as the icon
 * changing size on expand.
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
      <path d='M3.75 17.25A2 2 0 0 1 1.75 15.25V4.25A2 2 0 0 1 3.75 2.25H7L9.5 5.25H14.5A2 2 0 0 1 16.5 7.25V15.25A2 2 0 0 1 14.5 17.25Z' />
    </svg>
  )
}
