'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function InterfacesError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load interfaces'
      description='Something went wrong while loading the interfaces. Please try again.'
      loggerName='InterfacesError'
    />
  )
}
