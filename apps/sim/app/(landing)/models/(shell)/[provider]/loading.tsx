import { Loader } from '@sim/emcn'

export default function ModelProviderLoading() {
  return (
    <div className='flex min-h-[60vh] items-center justify-center bg-[var(--bg)]'>
      <Loader animate className='size-6 text-[var(--text-muted)]' />
    </div>
  )
}
