import { Loader2 } from 'lucide-react'

export default function TaskLoading() {
  return (
    <div className='flex h-full bg-[var(--bg)]'>
      <div className='flex h-full min-w-0 flex-1 flex-col'>
        <div className='flex min-h-0 flex-1 items-center justify-center'>
          <Loader2 className='h-[20px] w-[20px] animate-spin text-[var(--text-tertiary)]' />
        </div>
      </div>
    </div>
  )
}
