import type { ReactNode } from 'react'

interface FeatureGraphicShellProps {
  children: ReactNode
}

/** Shared crop canvas for platform-faithful enterprise feature previews. */
export function FeatureGraphicShell({ children }: FeatureGraphicShellProps) {
  return (
    <div className='relative mx-auto h-full min-h-[260px] w-full max-w-[420px] overflow-hidden'>
      <div className='relative h-full min-h-[260px]'>{children}</div>
    </div>
  )
}
