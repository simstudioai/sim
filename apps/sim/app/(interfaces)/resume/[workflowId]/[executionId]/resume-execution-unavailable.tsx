import { chipContentLabelClass, chipVariants, cn } from '@sim/emcn'

export function ResumeExecutionUnavailable() {
  return (
    <div className='flex flex-1 items-center justify-center p-6'>
      <div className='max-w-[400px] text-center'>
        <h1 className='mb-2 text-[var(--text-primary)] text-xl'>Execution Not Found</h1>
        <p className='mb-6 text-[var(--text-secondary)] text-sm'>
          This execution could not be located or has already completed.
        </p>
        <a href='/' className={chipVariants({ variant: 'border' })}>
          <span className={cn(chipContentLabelClass, 'flex-1')}>Return Home</span>
        </a>
      </div>
    </div>
  )
}
