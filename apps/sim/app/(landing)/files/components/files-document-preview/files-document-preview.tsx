'use client'

import { Chip } from '@sim/emcn'
import { ChevronRight, Download, Files, Send } from '@sim/emcn/icons'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'
import { LibraryFileDetail } from '@/app/(landing)/files/components/files-library-preview/components/library-file-detail'
import { FILES } from '@/app/(landing)/files/components/files-library-preview/data'

/** Files' real breadcrumb/action header over its single-surface markdown document. */
export function FilesDocumentPreview() {
  return (
    <div className='absolute top-16 left-10 w-[620px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs max-sm:left-6'>
      <MenuPreviewHeader
        icon={Files}
        title={
          <>
            <span>Files</span>
            <ChevronRight className='size-3 text-[var(--text-muted)]' />
            <span>Weekly report.md</span>
          </>
        }
        actions={
          <>
            <Chip leftIcon={Download}>Download</Chip>
            <Chip leftIcon={Send}>Share</Chip>
          </>
        }
      />
      <LibraryFileDetail file={FILES[0]} />
    </div>
  )
}
