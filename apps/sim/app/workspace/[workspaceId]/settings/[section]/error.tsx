'use client'

import { ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function SettingsSectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className='flex h-full items-center justify-center'>
      <ErrorState
        error={error}
        reset={reset}
        title='Something went wrong'
        description='An unexpected error occurred. Please try again or refresh the page.'
        loggerName='SettingsSectionError'
      />
    </div>
  )
}
