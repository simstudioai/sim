import { Loader2 } from 'lucide-react'

export default function WorkflowsLoading() {
  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-[var(--bg)]'>
      <div className='relative flex h-full w-full flex-1 items-center justify-center bg-[var(--bg)]'>
        <Loader2 className='h-[20px] w-[20px] animate-spin text-[var(--text-tertiary)]' />
      </div>
    </div>
  )
}
