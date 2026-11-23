import { Loader } from '@sim/emcn'

interface LoadingStatusProps {
  children: string
}

export function LoadingStatus({ children }: LoadingStatusProps) {
  return (
    <div
      role='status'
      className='m-auto flex items-center gap-2 text-[var(--text-muted)] text-small'
    >
      <Loader animate />
      {children}
    </div>
  )
}
