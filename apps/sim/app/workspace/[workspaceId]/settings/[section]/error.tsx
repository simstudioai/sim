'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function SettingsSectionError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Something went wrong'
      description='An unexpected error occurred. Please try again or refresh the page.'
      loggerName='SettingsSectionError'
    />
  )
}
