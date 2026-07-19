import type { ReactNode } from 'react'
import { FullstackAppGallery } from '../fullstack-app-gallery'

interface FullstackHomeProps {
  workspaceId: string
  isDemoMode: boolean
  prompt: ReactNode
}

export function FullstackHome({ workspaceId, isDemoMode, prompt }: FullstackHomeProps) {
  return (
    <div className='mx-auto flex min-h-full w-full max-w-[90rem] flex-col px-6 pb-12 sm:px-8'>
      <div className='mx-auto flex min-h-[50vh] w-full max-w-[48rem] flex-col items-center justify-end gap-4 text-center'>
        <h1 className='text-balance font-season text-[30px] text-[var(--text-primary)]'>
          Full-stack apps
        </h1>
        <p className='text-[var(--text-secondary)] text-sm'>
          {isDemoMode
            ? 'Describe an app. Hosted Mothership builds workflows on the left, then opens a live preview on the right.'
            : 'Build, preview, and publish React apps backed by existing deployed workflows.'}
        </p>
        <div className='relative w-full text-left'>{prompt}</div>
      </div>

      <div className='mt-8'>
        <FullstackAppGallery workspaceId={workspaceId} />
      </div>
    </div>
  )
}
