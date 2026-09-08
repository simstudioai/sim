import type { ComponentType } from 'react'
import { ChipTag, cn } from '@sim/emcn'
import { DocxIcon, PdfIcon } from '@/components/icons/document-icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/files/components/feature-graphics/file-library-graphic.module.css'
import { InteractiveLibraryFolder } from '@/app/(landing)/files/components/feature-graphics/interactive-library-folder'

interface LibraryDocument {
  name: string
  icon: ComponentType<{ className?: string }>
  size: string
}

interface LibraryDocumentCardProps {
  document: LibraryDocument
  className: string
}

const DOCUMENTS: readonly LibraryDocument[] = [
  { name: 'Guide.pdf', icon: PdfIcon, size: '1.2 MB' },
  { name: 'Brief.docx', icon: DocxIcon, size: '324 KB' },
]

const DOCUMENT_STEPS = [styles.item2, styles.item3] as const

/** An individual file card with its native type glyph and a small content preview. */
function LibraryDocumentCard({ document, className }: LibraryDocumentCardProps) {
  const Icon = document.icon

  return (
    <div
      className={cn(
        'flex aspect-[9/11] w-full min-w-0 flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-3 shadow-xs',
        className
      )}
    >
      <Icon className='size-6 shrink-0 text-[var(--text-icon)]' />
      <div className='flex min-h-0 flex-1 flex-col gap-2 pt-2'>
        <span className='h-px w-full bg-[var(--border)]' />
        <span className='h-px w-4/5 bg-[var(--border)]' />
        <span className='h-px w-3/5 bg-[var(--border)]' />
      </div>
      <div className='mt-auto min-w-0'>
        <span className='block whitespace-nowrap text-[13px] text-[var(--text-primary)] leading-5 [@container(max-width:320px)]:text-[11px]'>
          {document.name}
        </span>
        <span className='block text-[11px] text-[var(--text-muted)] leading-4'>
          {document.size}
        </span>
      </div>
    </div>
  )
}

/**
 * Two folders and two paper-proportioned documents make the shared library tangible.
 * Documents retain their shape while the folder row fills the remaining space.
 * The four items settle in once, with a static frame under reduced motion.
 */
export function FileLibraryGraphic() {
  return (
    <FeatureGraphicShell variant='portrait'>
      <div data-feature-graphic='files' className='absolute inset-0 flex justify-center p-5'>
        <div className='flex min-h-0 w-full flex-col gap-5 [container-type:inline-size]'>
          <div className='flex shrink-0 items-center justify-between'>
            <span className='text-[var(--text-primary)] text-base'>Files</span>
            <ChipTag variant='mono'>Shared</ChipTag>
          </div>
          <div className='grid min-h-0 flex-1 grid-cols-2 gap-5'>
            <InteractiveLibraryFolder
              name='Brand assets'
              count='12 files'
              className={styles.item0}
            />
            <InteractiveLibraryFolder name='Reports' count='8 files' className={styles.item1} />
          </div>
          <div className='grid shrink-0 grid-cols-2 gap-5'>
            {DOCUMENTS.map((document, index) => (
              <LibraryDocumentCard
                key={document.name}
                document={document}
                className={DOCUMENT_STEPS[index]}
              />
            ))}
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
