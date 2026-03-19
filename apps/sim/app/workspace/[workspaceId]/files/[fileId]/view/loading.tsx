import { Loader2 } from 'lucide-react'

export default function FileViewLoading() {
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg)]'>
      <Loader2 className='h-[20px] w-[20px] animate-spin text-[var(--text-tertiary)]' />
    </div>
  )
}
