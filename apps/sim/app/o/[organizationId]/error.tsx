'use client'

import {
  type ErrorBoundaryProps,
  ErrorState,
} from '@/app/workspace/[workspaceId]/components/error/error'

export default function OrganizationError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Something went wrong'
      description='An unexpected error occurred. Please try again or refresh the page.'
      loggerName='OrganizationError'
    />
  )
}
