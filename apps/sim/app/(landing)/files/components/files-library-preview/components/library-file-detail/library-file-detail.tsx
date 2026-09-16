import { noop } from '@sim/utils/helpers'
import type { LibraryFile } from '@/app/(landing)/files/components/files-library-preview/data'
import { PreviewToolbar } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-toolbar'

interface LibraryFileDetailProps {
  file: LibraryFile
}

/** The document replaces the resource list, matching the actual Files viewer. */
export function LibraryFileDetail({ file }: LibraryFileDetailProps) {
  return (
    <div
      role='region'
      aria-label={`${file.name} preview`}
      className='min-h-0 flex-1 overflow-y-auto'
    >
      {file.type === 'PDF' && (
        <div aria-hidden='true' inert>
          <PreviewToolbar
            navigation={{ current: 1, total: 1, label: 'page', onPrevious: noop, onNext: noop }}
            zoom={{
              label: '100%',
              onZoomOut: noop,
              onZoomIn: noop,
              canZoomOut: false,
              canZoomIn: false,
            }}
          />
        </div>
      )}
      <div className='mx-auto max-w-[48rem] px-8 py-6 text-[var(--text-primary)] text-base leading-[25px] max-sm:px-5'>
        <p className='text-[24px] leading-[1.3]'>{file.title}</p>
        <p className='mt-4'>{file.excerpt}</p>
        <p className='mt-7 text-[19px] leading-[1.3]'>What moved forward</p>
        <ul className='mt-3 list-disc space-y-2 pl-6'>
          <li>Reviewed campaign performance</li>
          <li>Shared customer feedback with the team</li>
        </ul>
        <p className='mt-7 text-[19px] leading-[1.3]'>Next steps</p>
        <p className='mt-3'>
          Bring the findings into next week’s brief and follow up on the opportunities.
        </p>
      </div>
    </div>
  )
}
