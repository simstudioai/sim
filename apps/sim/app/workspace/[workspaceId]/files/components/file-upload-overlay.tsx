import { Upload } from '@sim/emcn'

interface FileUploadOverlayProps {
  destination: string
}

export function FileUploadOverlay({ destination }: FileUploadOverlayProps) {
  return (
    <div className='pointer-events-none absolute inset-0 z-[var(--z-dropdown)] flex flex-col items-center justify-center gap-2 border border-[var(--brand-secondary)] border-dashed bg-[var(--white)] transition-colors dark:bg-[var(--surface-4)]'>
      <Upload className='size-5 text-[var(--brand-secondary)]' />
      <div className='flex flex-col gap-0.5 text-center'>
        <p className='text-[var(--brand-secondary)] text-sm'>Drop to upload</p>
        <p className='text-[var(--text-tertiary)] text-xs'>
          Release files here to add them to {destination}
        </p>
      </div>
    </div>
  )
}
