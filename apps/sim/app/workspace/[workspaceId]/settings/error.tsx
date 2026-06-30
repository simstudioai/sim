'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function SettingsError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load settings'
      description='Something went wrong while loading your settings. Please try again.'
      loggerName='SettingsError'
    />
  )
}
