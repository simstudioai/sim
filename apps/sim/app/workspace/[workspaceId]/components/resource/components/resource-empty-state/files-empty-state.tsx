import { Chip, cn } from '@sim/emcn'
import { Upload } from '@sim/emcn/icons'
import { EmptyState } from '@/components/empty-state/empty-state'
import { EmptyStateDocsLink } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/docs-link'
import { HAIRLINE } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/hairline'
import { MASK_NO_REPEAT } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/mask'

const FILES_DOCS_URL = 'https://docs.sim.ai/files'

const FOLDER_BACK = [
  'M 22 34',
  'H 66',
  'Q 72 34 75.5 38',
  'L 82.5 46',
  'Q 86 50 92 50',
  'H 178',
  'Q 188 50 188 60',
  'V 140',
  'Q 188 150 178 150',
  'H 22',
  'Q 12 150 12 140',
  'V 44',
  'Q 12 34 22 34',
  'Z',
].join(' ')

/**
 * Dissolves upward, so the folder rises out of the page while its front panel
 * stays crisp where the copy begins. Running it the other way — the direction the
 * logs feed fades — ate the panel's base and left the tab hanging.
 */
const FOLDER_FADE =
  '[-webkit-mask-image:linear-gradient(to_top,#000_58%,transparent_100%)] [mask-image:linear-gradient(to_top,#000_58%,transparent_100%)]'

/**
 * A folder held open with sheets standing proud of its front panel.
 *
 * Depth is carried by the surface ramp rather than by shadow: the back panel sits a
 * tier down on `--surface-4`, everything in front of it on `--surface-2`. Shadows
 * would need separate light and dark recipes; the ramp inverts on its own.
 *
 * Unlike the tables grid — where a skeleton bar has no outline and so needs mid-grey
 * ink to survive a light page — the hairline draws this shape, so the fills only have
 * to separate one layer from the next and a near-white tier carries it.
 */
function FilesGraphic() {
  return (
    <svg
      viewBox='0 0 200 160'
      width={185}
      height={148}
      fill='none'
      aria-hidden='true'
      focusable='false'
      className={cn('block max-w-none shrink-0', FOLDER_FADE, MASK_NO_REPEAT)}
    >
      <path d={FOLDER_BACK} fill='var(--surface-4)' {...HAIRLINE} />

      <rect x='34' y='56' width='132' height='84' rx='5' fill='var(--surface-2)' {...HAIRLINE} />
      <rect x='26' y='64' width='148' height='76' rx='5' fill='var(--surface-2)' {...HAIRLINE} />

      <rect x='12' y='74' width='176' height='76' rx='10' fill='var(--surface-2)' {...HAIRLINE} />
    </svg>
  )
}

interface FilesEmptyStateProps {
  /** Opens the file picker — the same action the header's upload chip runs. */
  onUpload: () => void
  /** Mirrors the header chip's disabled state: no edit rights, or an upload in flight. */
  uploadDisabled?: boolean
}

/** Empty state for the files list when the workspace has none. */
export function FilesEmptyState({ onUpload, uploadDisabled = false }: FilesEmptyStateProps) {
  return (
    <EmptyState
      graphic={<FilesGraphic />}
      title='Files'
      description='Upload files to share them across your team and every agent.'
      action={
        <>
          <Chip variant='primary' onClick={onUpload} disabled={uploadDisabled} leftIcon={Upload}>
            Upload
          </Chip>
          <EmptyStateDocsLink href={FILES_DOCS_URL} />
        </>
      }
    />
  )
}
