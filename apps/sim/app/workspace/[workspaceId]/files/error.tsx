'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function FilesError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load files'
      description='Something went wrong while loading your files. Please try again.'
      loggerName='FilesError'
    />
  )
}
