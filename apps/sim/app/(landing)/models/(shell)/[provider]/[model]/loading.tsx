import { Loader } from '@/components/emcn'

export default function ModelDetailLoading() {
  return (
    <div className='flex min-h-[60vh] items-center justify-center bg-[var(--landing-bg)]'>
      <Loader animate className='h-6 w-6 text-[var(--landing-text-muted)]' />
    </div>
  )
}
